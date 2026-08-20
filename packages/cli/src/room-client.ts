import {
  claimJoinCredential,
  clearActiveJoinCredential,
  loadActiveJoinCredential,
  resolveWaitloopServerUrl,
  safeJoinMetadata,
  setActiveJoinCredential,
  type JoinCredentialV1,
} from "./join.js";

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: unknown;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

export interface WaitloopClientErrorOptions {
  nextAction?: string;
  retrySafe?: boolean;
}

export class WaitloopClientError extends Error {
  readonly code: string;
  readonly nextAction: string | undefined;
  readonly retrySafe: boolean | undefined;

  constructor(code: string, message: string, options: WaitloopClientErrorOptions = {}) {
    super(message);
    this.name = "WaitloopClientError";
    this.code = code;
    this.nextAction = options.nextAction;
    this.retrySafe = options.retrySafe;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function remoteError(body: unknown): { code?: string; message?: string } {
  if (!isRecord(body) || !isRecord(body.error)) return {};
  return {
    ...(typeof body.error.code === "string" ? { code: body.error.code } : {}),
    ...(typeof body.error.message === "string" ? { message: body.error.message } : {}),
  };
}

function errorMessage(body: unknown, fallback: string): string {
  return remoteError(body).message ?? fallback;
}

function readOnlyTool(name: string): boolean {
  return name === "get_turn" || name === "wait_for_turn";
}

function nextActionForCode(code: string): string | undefined {
  if (code === "rate_limited") return "Wait briefly, then retry the same operation.";
  if (code === "room_auth_failed" || code === "room_not_found" || code === "room_expired") {
    return "The active Room can no longer be used. Use create_room() or join_room(code) with a fresh Join code.";
  }
  if (code === "stale_revision") return "Call get_turn() again and use the returned revision and legal move ID.";
  if (code === "not_controller" || code === "forbidden" || code === "seat_not_controller") {
    return "Call get_turn() to inspect Controller state; use take_control() only when this Actor owns the Seat and reclaim is allowed.";
  }
  return undefined;
}

function httpErrorCode(status: number): string {
  if (status === 401 || status === 403) return "room_auth_failed";
  if (status === 404) return "room_not_found";
  if (status === 410) return "room_expired";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "remote_unavailable";
  return "remote_http_error";
}

function cancellationError(name: string): WaitloopClientError {
  return new WaitloopClientError("request_cancelled", `Waitloop ${name} was cancelled by the MCP client.`, {
    nextAction: readOnlyTool(name)
      ? "No corrective action is required. Retry the same read/wait only if the user still wants to continue."
      : "Call get_turn() before retrying; a cancelled transport can make a mutating request's remote outcome uncertain.",
    retrySafe: readOnlyTool(name),
  });
}

function networkError(name: string, error: unknown): WaitloopClientError {
  const detail = error instanceof Error && error.message ? ` ${error.message}` : "";
  return new WaitloopClientError("network_unavailable", `Waitloop could not reach the remote Room.${detail}`, {
    nextAction: readOnlyTool(name)
      ? "Retry the same read/wait. The local active Room selection is preserved."
      : "Call get_turn() before retrying; the remote outcome may be unknown after a transport failure.",
    retrySafe: readOnlyTool(name),
  });
}

async function responseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const value = line.slice("data:".length).trim();
      if (!value || value === "[DONE]") continue;
      try {
        return JSON.parse(value);
      } catch {
        continue;
      }
    }
    return text;
  }
}

function parseToolPayload(response: JsonRpcResponse, toolName: string): unknown {
  if (response.error) {
    throw new WaitloopClientError("mcp_rpc_error", response.error.message ?? "Waitloop MCP returned an error.", {
      nextAction: readOnlyTool(toolName) ? "Retry the same read/wait." : "Call get_turn() before deciding whether to retry.",
      retrySafe: readOnlyTool(toolName),
    });
  }
  if (!isRecord(response.result)) throw new WaitloopClientError("invalid_mcp_response", "Waitloop MCP returned an invalid tool result.");
  const content = response.result.content;
  const isError = response.result.isError === true;
  if (!Array.isArray(content)) throw new WaitloopClientError("invalid_mcp_response", "Waitloop MCP tool result is missing content.");
  const textItem = content.find((item) => isRecord(item) && item.type === "text" && typeof item.text === "string");
  if (!isRecord(textItem) || typeof textItem.text !== "string") {
    throw new WaitloopClientError("invalid_mcp_response", "Waitloop MCP tool result has no text payload.");
  }

  let payload: unknown = textItem.text;
  try {
    payload = JSON.parse(textItem.text);
  } catch {
    // Plain text remains valid for future tools.
  }
  if (isError || (isRecord(payload) && isRecord(payload.error))) {
    const parsed = remoteError(payload);
    const code = parsed.code ?? "remote_tool_error";
    const nextAction = nextActionForCode(code);
    throw new WaitloopClientError(code, parsed.message ?? "Waitloop MCP tool call failed.", {
      ...(nextAction ? { nextAction } : {}),
      retrySafe: readOnlyTool(toolName),
    });
  }
  return payload;
}

export async function callRoomTool(
  credential: JoinCredentialV1,
  name: string,
  args: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<unknown> {
  try {
    const response = await fetch(credential.mcp.url, {
      method: "POST",
      headers: {
        ...credential.mcp.headers,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method: "tools/call",
        params: { name, arguments: args },
      }),
      ...(signal ? { signal } : {}),
    });
    const body = await responseBody(response);
    if (!response.ok) {
      const parsed = remoteError(body);
      const code = parsed.code ?? httpErrorCode(response.status);
      const nextAction = nextActionForCode(code);
      throw new WaitloopClientError(code, parsed.message ?? `Waitloop MCP request failed with HTTP ${response.status}.`, {
        ...(nextAction ? { nextAction } : {}),
        retrySafe: readOnlyTool(name),
      });
    }
    if (!isRecord(body)) throw new WaitloopClientError("invalid_mcp_response", "Waitloop MCP returned an invalid JSON-RPC response.");
    return parseToolPayload(body as JsonRpcResponse, name);
  } catch (error) {
    if (error instanceof WaitloopClientError) throw error;
    if (signal?.aborted || isAbortError(error)) throw cancellationError(name);
    throw networkError(name, error);
  }
}

export async function joinAndActivateRoom(code: string, explicitServerUrl?: string, signal?: AbortSignal) {
  const serverUrl = await resolveWaitloopServerUrl(explicitServerUrl);
  let credential: JoinCredentialV1;
  try {
    credential = await claimJoinCredential(code, serverUrl);
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw cancellationError("join_room");
    if (error instanceof WaitloopClientError) throw error;
    throw new WaitloopClientError("join_failed", error instanceof Error ? error.message : "Waitloop Join failed.", {
      nextAction: "If the Join code expired or was already claimed, obtain a fresh Join code and call join_room(code) again.",
      retrySafe: false,
    });
  }
  if (signal?.aborted) throw cancellationError("join_room");
  await setActiveJoinCredential(credential);
  const snapshot = await callRoomTool(credential, "get_turn", {}, signal);
  return {
    ...safeJoinMetadata(credential),
    connected: true,
    snapshot,
  };
}

export async function createAndActivateHeadlessRoom(explicitServerUrl?: string, signal?: AbortSignal) {
  const serverUrl = await resolveWaitloopServerUrl(explicitServerUrl);
  let response: Response;
  let body: unknown;
  try {
    response = await fetch(`${serverUrl}/api/v1/rooms`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ version: 1, gameId: "doudizhu", mode: "agent-bots" }),
      ...(signal ? { signal } : {}),
    });
    body = await responseBody(response);
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw cancellationError("create_room");
    throw networkError("create_room", error);
  }
  if (!response.ok) throw new WaitloopClientError(httpErrorCode(response.status), errorMessage(body, `Waitloop room creation failed with HTTP ${response.status}.`));
  if (!isRecord(body) || body.version !== 1 || typeof body.joinCode !== "string") {
    throw new WaitloopClientError("invalid_room_response", "Waitloop room creation did not return a Join code.");
  }
  return joinAndActivateRoom(body.joinCode, serverUrl, signal);
}

export async function getActiveRoom(signal?: AbortSignal) {
  const credential = await loadActiveJoinCredential();
  if (!credential) return null;
  const snapshot = await callRoomTool(credential, "get_turn", {}, signal);
  return {
    ...safeJoinMetadata(credential),
    connected: true,
    snapshot,
  };
}

function invalidatesActiveRoom(error: unknown): boolean {
  return error instanceof WaitloopClientError && (
    error.code === "room_auth_failed" || error.code === "room_not_found" || error.code === "room_expired"
  );
}

export async function callActiveRoomTool(
  name: string,
  args: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<unknown> {
  const credential = await loadActiveJoinCredential();
  if (!credential) {
    throw new WaitloopClientError("no_active_room", "No active Waitloop room.", {
      nextAction: "Use create_room() or join_room(code) first.",
      retrySafe: false,
    });
  }
  try {
    return await callRoomTool(credential, name, args, signal);
  } catch (error) {
    if (invalidatesActiveRoom(error)) await clearActiveJoinCredential().catch(() => false);
    throw error;
  }
}

export async function leaveActiveRoom() {
  const active = await loadActiveJoinCredential();
  const cleared = await clearActiveJoinCredential();
  return {
    version: 1,
    left: cleared,
    ...(active ? { roomId: active.roomId, actorId: active.actorId, seatId: active.seatId } : {}),
    credentialRevoked: false,
    note: "Local active-room selection was cleared; the room credential remains cached until room expiry.",
  };
}
