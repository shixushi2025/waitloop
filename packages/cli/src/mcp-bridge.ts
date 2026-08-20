import { createInterface } from "node:readline";

import {
  callActiveRoomTool,
  createAndActivateHeadlessRoom,
  getActiveRoom,
  joinAndActivateRoom,
  leaveActiveRoom,
} from "./room-client.js";
import { getCliVersion } from "./version.js";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

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
  "Waitloop keeps room credentials inside the local bridge. Use create_room for a headless Agent-vs-bots table or join_room with a WL code, then use wait_for_turn instead of polling. If the user asks to play continuously or finish a game, keep the current Agent run active until that stopping condition is reached. Transport timeout never auto-passes or changes Casual game state.";

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
      "Wait until the active room Actor can play or another actionable state occurs. timeoutMs only bounds one tool call and never forces a move or takeover.",
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

function rpcError(id: JsonRpcRequest["id"], code: number, message: string) {
  return { jsonrpc: "2.0" as const, id: id ?? null, error: { code, message } };
}

function toolResult(value: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    ...(isError ? { isError: true } : {}),
  };
}

function objectArgs(params: unknown): Record<string, unknown> {
  if (!isRecord(params) || typeof params.name !== "string") throw new Error("tools/call requires a tool name.");
  if (params.arguments === undefined) return {};
  if (!isRecord(params.arguments)) throw new Error("Tool arguments must be an object.");
  return params.arguments;
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

async function callLocalTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === "create_room") {
    if (args.gameId !== undefined && args.gameId !== "doudizhu") throw new Error("Only gameId doudizhu is currently supported.");
    if (args.mode !== undefined && args.mode !== "agent-bots") throw new Error("Local MCP create_room currently supports mode agent-bots.");
    return createAndActivateHeadlessRoom();
  }
  if (name === "join_room") return joinAndActivateRoom(requiredString(args, "code", 32));
  if (name === "get_active_room") {
    const room = await getActiveRoom();
    return room ?? { version: 1, active: false, message: "No active Waitloop room." };
  }
  if (name === "leave_room") return leaveActiveRoom();
  if (name === "get_turn") return callActiveRoomTool("get_turn");
  if (name === "wait_for_turn") {
    const timeoutMs = args.timeoutMs;
    if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || (timeoutMs as number) < 1_000 || (timeoutMs as number) > 25_000)) {
      throw new Error("timeoutMs must be an integer between 1000 and 25000.");
    }
    return callActiveRoomTool("wait_for_turn", timeoutMs === undefined ? {} : { timeoutMs });
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

export async function handleLocalMcpMessage(message: unknown): Promise<Record<string, unknown> | null> {
  if (!isRecord(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return rpcError(null, -32600, "Invalid JSON-RPC request.");
  }
  const request = message as unknown as JsonRpcRequest;
  const notification = request.id === undefined;

  if (request.method === "notifications/initialized" || request.method === "notifications/cancelled") return null;
  if (request.method === "initialize") {
    if (notification) return null;
    const requestedVersion = isRecord(request.params) && typeof request.params.protocolVersion === "string"
      ? request.params.protocolVersion
      : "2025-03-26";
    return {
      jsonrpc: "2.0",
      id: request.id ?? null,
      result: {
        protocolVersion: requestedVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "waitloop-local", version: getCliVersion() },
        instructions: LOCAL_MCP_INSTRUCTIONS,
      },
    };
  }
  if (request.method === "ping") {
    if (notification) return null;
    return { jsonrpc: "2.0", id: request.id ?? null, result: {} };
  }
  if (request.method === "tools/list") {
    if (notification) return null;
    return { jsonrpc: "2.0", id: request.id ?? null, result: { tools: LOCAL_MCP_TOOLS } };
  }
  if (request.method === "tools/call") {
    if (notification) return null;
    try {
      if (!isRecord(request.params) || typeof request.params.name !== "string") {
        return rpcError(request.id, -32602, "tools/call requires name and arguments.");
      }
      const value = await callLocalTool(request.params.name, objectArgs(request.params));
      return { jsonrpc: "2.0", id: request.id ?? null, result: toolResult(value) };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      return { jsonrpc: "2.0", id: request.id ?? null, result: toolResult({ error: { code: "waitloop_error", message: messageText } }, true) };
    }
  }
  if (notification) return null;
  return rpcError(request.id, -32601, `Method not found: ${request.method}`);
}

export async function runLocalMcpBridge(): Promise<void> {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      process.stdout.write(`${JSON.stringify(rpcError(null, -32700, "Parse error."))}\n`);
      continue;
    }
    const response = await handleLocalMcpMessage(message);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}
