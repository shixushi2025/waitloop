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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(body: unknown, fallback: string): string {
  if (isRecord(body) && isRecord(body.error) && typeof body.error.message === "string") return body.error.message;
  return fallback;
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

function parseToolPayload(response: JsonRpcResponse): unknown {
  if (response.error) throw new Error(response.error.message ?? "Waitloop MCP returned an error.");
  if (!isRecord(response.result)) throw new Error("Waitloop MCP returned an invalid tool result.");
  const content = response.result.content;
  const isError = response.result.isError === true;
  if (!Array.isArray(content)) throw new Error("Waitloop MCP tool result is missing content.");
  const textItem = content.find((item) => isRecord(item) && item.type === "text" && typeof item.text === "string");
  if (!isRecord(textItem) || typeof textItem.text !== "string") throw new Error("Waitloop MCP tool result has no text payload.");

  let payload: unknown = textItem.text;
  try {
    payload = JSON.parse(textItem.text);
  } catch {
    // Plain text remains valid for future tools.
  }
  if (isError) throw new Error(errorMessage(payload, "Waitloop MCP tool call failed."));
  if (isRecord(payload) && isRecord(payload.error)) throw new Error(errorMessage(payload, "Waitloop MCP tool call failed."));
  return payload;
}

export async function callRoomTool(
  credential: JoinCredentialV1,
  name: string,
  args: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<unknown> {
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
  if (!response.ok) throw new Error(errorMessage(body, `Waitloop MCP request failed with HTTP ${response.status}.`));
  if (!isRecord(body)) throw new Error("Waitloop MCP returned an invalid JSON-RPC response.");
  return parseToolPayload(body as JsonRpcResponse);
}

export async function joinAndActivateRoom(code: string, explicitServerUrl?: string) {
  const serverUrl = await resolveWaitloopServerUrl(explicitServerUrl);
  const credential = await claimJoinCredential(code, serverUrl);
  await setActiveJoinCredential(credential);
  const snapshot = await callRoomTool(credential, "get_turn");
  return {
    ...safeJoinMetadata(credential),
    connected: true,
    snapshot,
  };
}

export async function createAndActivateHeadlessRoom(explicitServerUrl?: string) {
  const serverUrl = await resolveWaitloopServerUrl(explicitServerUrl);
  const response = await fetch(`${serverUrl}/api/v1/rooms`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ version: 1, gameId: "doudizhu", mode: "agent-bots" }),
  });
  const body = await responseBody(response);
  if (!response.ok) throw new Error(errorMessage(body, `Waitloop room creation failed with HTTP ${response.status}.`));
  if (!isRecord(body) || body.version !== 1 || typeof body.joinCode !== "string") {
    throw new Error("Waitloop room creation did not return a Join code.");
  }
  return joinAndActivateRoom(body.joinCode, serverUrl);
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

export async function callActiveRoomTool(
  name: string,
  args: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<unknown> {
  const credential = await loadActiveJoinCredential();
  if (!credential) throw new Error("No active Waitloop room. Use create_room or join_room first.");
  return callRoomTool(credential, name, args, signal);
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
