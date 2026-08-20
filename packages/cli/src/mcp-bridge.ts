import { fromJsonSchema, McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

import {
  callActiveRoomTool,
  createAndActivateHeadlessRoom,
  getActiveRoom,
  joinAndActivateRoom,
  leaveActiveRoom,
} from "./room-client.js";
import { getCliVersion } from "./version.js";

interface LocalToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const EMPTY_OBJECT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

export const LOCAL_MCP_INSTRUCTIONS =
  "Waitloop keeps room credentials inside the local bridge. Use create_room for a headless Agent-vs-bots table or join_room with a WL code, then use wait_for_turn instead of polling. If the user asks to play continuously or finish a game, keep the current Agent run active until that stopping condition is reached. Transport timeout or cancellation never auto-passes, plays, changes Controller, or mutates Casual game state.";

export const LOCAL_MCP_TOOLS: readonly LocalToolDefinition[] = [
  {
    name: "create_room",
    description:
      "Create and immediately join a headless Dou Dizhu room where this Agent owns seat-1 against two deterministic bots. The bridge calls the Room/Join HTTP APIs internally and keeps credentials local.",
    inputSchema: {
      type: "object",
      properties: {
        gameId: { type: "string", enum: ["doudizhu"], default: "doudizhu" },
        mode: { type: "string", enum: ["agent-bots"], default: "agent-bots" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "join_room",
    description:
      "Claim a one-time WL Join code, cache the room Actor credential locally, make it the active room, and authenticate one game request so the Actor is actually connected.",
    inputSchema: {
      type: "object",
      properties: { code: { type: "string", pattern: "^WL-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$" } },
      required: ["code"],
      additionalProperties: false,
    },
  },
  {
    name: "get_active_room",
    description: "Return safe metadata and the current snapshot for the bridge's active room. Raw credentials are never returned.",
    inputSchema: EMPTY_OBJECT_SCHEMA,
  },
  {
    name: "leave_room",
    description:
      "Clear the local active-room selection. This does not revoke the cached room credential or mutate the remote game, so an explicit reconnect remains possible until room expiry.",
    inputSchema: EMPTY_OBJECT_SCHEMA,
  },
  {
    name: "get_turn",
    description: "Get the current private projection, public state, capabilities, revision, Controller, and legal move IDs for the active room Actor.",
    inputSchema: EMPTY_OBJECT_SCHEMA,
  },
  {
    name: "wait_for_turn",
    description:
      "Wait until the active room Actor can play or another actionable state occurs. timeoutMs only bounds one tool call and never forces a move or takeover. The host may cancel this read-only wait safely.",
    inputSchema: {
      type: "object",
      properties: { timeoutMs: { type: "integer", minimum: 1000, maximum: 25000, default: 25000 } },
      additionalProperties: false,
    },
  },
  {
    name: "play_move",
    description: "Play one exact server-generated move ID using the current revision for the active room Actor.",
    inputSchema: {
      type: "object",
      properties: {
        expectedRevision: { type: "integer", minimum: 0 },
        moveId: { type: "string", minLength: 1, maxLength: 512 },
      },
      required: ["expectedRevision", "moveId"],
      additionalProperties: false,
    },
  },
  {
    name: "comment",
    description: "Post a short side-channel comment without mutating game revision, rules, or turn order.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", minLength: 1, maxLength: 280 } },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "yield_to_bot",
    description: "Explicitly let a deterministic temporary Bot control the same owned Seat while preserving owner, hand, role, and history.",
    inputSchema: EMPTY_OBJECT_SCHEMA,
  },
  {
    name: "take_control",
    description: "Explicitly reclaim an owned Seat from its temporary Bot after reconnecting.",
    inputSchema: EMPTY_OBJECT_SCHEMA,
  },
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(args: Record<string, unknown>, key: string, maxLength: number): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(`${key} must be a non-empty string.`);
  }
  return value;
}

function requiredRevision(args: Record<string, unknown>): number {
  const value = args.expectedRevision;
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error("expectedRevision must be a non-negative integer.");
  return value as number;
}

function toolResult(value: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    ...(isError ? { isError: true } : {}),
  };
}

function redactCredentialText(value: string): string {
  return value.replace(/\bwl(?:seat|dev|view|room|join|a)_[A-Za-z0-9._~-]+\b/g, "[redacted]");
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function localToolErrorPayload(error: unknown): { code: string; message: string; nextAction: string } {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = redactCredentialText(rawMessage);
  const lower = message.toLowerCase();

  if (isAbortError(error)) {
    return {
      code: "cancelled",
      message: "Waitloop tool call was cancelled.",
      nextAction: "Retry when ready; the active Room selection is preserved.",
    };
  }
  if (lower.includes("no active waitloop room")) {
    return {
      code: "active_room_missing",
      message,
      nextAction: "Use create_room() or join_room(code) before calling Room tools.",
    };
  }
  if (lower.includes("expired")) {
    return {
      code: "active_room_expired",
      message,
      nextAction: "Create a new Room or join again with a fresh Join code.",
    };
  }
  if (lower.includes("fetch failed") || lower.includes("network") || lower.includes("econn") || lower.includes("enotfound")) {
    return {
      code: "network_unavailable",
      message,
      nextAction: "Retry after connectivity recovers; the active Room selection is preserved.",
    };
  }
  return {
    code: "waitloop_error",
    message,
    nextAction: "Use get_active_room() to refresh state before deciding whether to retry.",
  };
}

function signalForRemoteRead(name: string, signal: AbortSignal | undefined): AbortSignal | undefined {
  return name === "get_turn" || name === "wait_for_turn" ? signal : undefined;
}

async function callLocalTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  if (name === "create_room") {
    if (args.gameId !== undefined && args.gameId !== "doudizhu") throw new Error("Only gameId doudizhu is currently supported.");
    if (args.mode !== undefined && args.mode !== "agent-bots") throw new Error("Local MCP create_room currently supports mode agent-bots.");
    return createAndActivateHeadlessRoom();
  }
  if (name === "join_room") return joinAndActivateRoom(requiredString(args, "code", 32));
  if (name === "get_active_room") {
    const room = await getActiveRoom(signal);
    return room ?? { version: 1, active: false, message: "No active Waitloop room." };
  }
  if (name === "leave_room") return leaveActiveRoom();
  if (name === "get_turn") return callActiveRoomTool("get_turn", {}, signalForRemoteRead(name, signal));
  if (name === "wait_for_turn") {
    const timeoutMs = args.timeoutMs;
    if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || (timeoutMs as number) < 1_000 || (timeoutMs as number) > 25_000)) {
      throw new Error("timeoutMs must be an integer between 1000 and 25000.");
    }
    return callActiveRoomTool(
      "wait_for_turn",
      timeoutMs === undefined ? {} : { timeoutMs },
      signalForRemoteRead(name, signal),
    );
  }
  if (name === "play_move") {
    return callActiveRoomTool("play_move", {
      expectedRevision: requiredRevision(args),
      moveId: requiredString(args, "moveId", 512),
    });
  }
  if (name === "comment") return callActiveRoomTool("comment", { text: requiredString(args, "text", 280) });
  if (name === "yield_to_bot") return callActiveRoomTool("yield_to_bot");
  if (name === "take_control") return callActiveRoomTool("take_control");
  throw new Error(`Unknown Waitloop tool: ${name}`);
}

export function createLocalMcpServer(): McpServer {
  const server = new McpServer(
    { name: "waitloop-local", version: getCliVersion() },
    { instructions: LOCAL_MCP_INSTRUCTIONS },
  );

  for (const tool of LOCAL_MCP_TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: fromJsonSchema(tool.inputSchema as Parameters<typeof fromJsonSchema>[0]),
      },
      async (rawArgs, ctx) => {
        try {
          const args = isRecord(rawArgs) ? rawArgs : {};
          const value = await callLocalTool(tool.name, args, ctx.mcpReq.signal);
          return toolResult(value);
        } catch (error) {
          return toolResult({ error: localToolErrorPayload(error) }, true);
        }
      },
    );
  }

  return server;
}

export function runLocalMcpBridge(): void {
  void serveStdio(createLocalMcpServer);
}
