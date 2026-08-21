import { fromJsonSchema, McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

import {
  createHumanGame,
  getHumanGame,
  hintHumanTurn,
  passHumanTurn,
  playHumanCards,
} from "./human-room-client.js";
import {
  MCP_APP_MIME_TYPE,
  WAITLOOP_GAME_APP_HTML,
  WAITLOOP_GAME_UI_URI,
} from "./mcp-app.js";
import {
  callActiveRoomTool,
  createAndActivateHeadlessRoom,
  getActiveRoom,
  joinAndActivateRoom,
  leaveActiveRoom,
} from "./room-client.js";
import { getCliVersion } from "./version.js";

type UiVisibility = "model" | "app";

interface LocalToolDefinition {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  uiVisibility?: readonly UiVisibility[];
  structuredResult?: boolean;
}

const EMPTY_OBJECT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

const ROOM_ID_SCHEMA = {
  type: "string",
  pattern: "^[A-Za-z0-9._:-]{1,128}$",
} as const;

export const LOCAL_MCP_INSTRUCTIONS =
  "Waitloop keeps all Room credentials inside the local bridge. When the user wants to click cards and play personally inside the Agent client, call open_game() so an MCP Apps-capable Host can render the Human table. Use create_room() only when the Agent should own seat-1 and play autonomously against bots. Use join_room() with a WL code for an existing Agent seat, then use wait_for_turn instead of polling. If the user asks the Agent to play continuously or finish a game, keep the current Agent run active until that stopping condition is reached. Transport timeout or cancellation never auto-passes, plays, changes Controller, or mutates Casual game state. Hosts without MCP Apps still receive text fallback instructions.";

export const LOCAL_MCP_TOOLS: readonly LocalToolDefinition[] = [
  {
    name: "open_game",
    title: "Open interactive Waitloop game",
    description:
      "Start or reopen a Human-controlled Dou Dizhu table for the user to operate through an inline MCP App. Use this instead of create_room when the user says they want to play, click cards, pass, or request hints themselves. On Hosts without MCP Apps, explain the returned web/tool fallback rather than pretending inline controls exist.",
    inputSchema: {
      type: "object",
      properties: {
        gameId: { type: "string", enum: ["doudizhu"], default: "doudizhu" },
        mode: { type: "string", enum: ["human-bots"], default: "human-bots" },
        roomId: {
          ...ROOM_ID_SCHEMA,
          description: "Optional previously created local interactive Room to reopen.",
        },
      },
      additionalProperties: false,
    },
    uiVisibility: ["model", "app"],
    structuredResult: true,
  },
  {
    name: "create_room",
    description:
      "Create and immediately join a headless Dou Dizhu room where this Agent owns seat-1 against two deterministic bots. Use open_game instead when the Human wants clickable controls. The bridge calls the Room/Join HTTP APIs internally and keeps credentials local.",
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
    description: "Return safe metadata and the current snapshot for the bridge's active Agent room. Raw credentials are never returned.",
    inputSchema: EMPTY_OBJECT_SCHEMA,
  },
  {
    name: "leave_room",
    description:
      "Clear the local active Agent-room selection. This does not revoke the cached room credential or mutate the remote game, so an explicit reconnect remains possible until room expiry.",
    inputSchema: EMPTY_OBJECT_SCHEMA,
  },
  {
    name: "get_turn",
    description: "Get the current private projection, public state, capabilities, revision, Controller, and legal move IDs for the active room Agent.",
    inputSchema: EMPTY_OBJECT_SCHEMA,
  },
  {
    name: "wait_for_turn",
    description:
      "Wait until the active room Agent can play or another actionable state occurs. timeoutMs only bounds one tool call and never forces a move or takeover. The host may cancel this read-only wait safely.",
    inputSchema: {
      type: "object",
      properties: { timeoutMs: { type: "integer", minimum: 1000, maximum: 25000, default: 25000 } },
      additionalProperties: false,
    },
  },
  {
    name: "play_move",
    description: "Play one exact server-generated move ID using the current revision for the active room Agent.",
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
  {
    name: "ui_get_game",
    title: "Refresh interactive game",
    description: "MCP App-only: refresh one private Human table. The model should use open_game(roomId) instead.",
    inputSchema: {
      type: "object",
      properties: { roomId: ROOM_ID_SCHEMA },
      required: ["roomId"],
      additionalProperties: false,
    },
    uiVisibility: ["app"],
    structuredResult: true,
  },
  {
    name: "ui_play_cards",
    title: "Play selected cards",
    description: "MCP App-only: submit the Human's selected card IDs for one exact Room revision.",
    inputSchema: {
      type: "object",
      properties: {
        roomId: ROOM_ID_SCHEMA,
        expectedRevision: { type: "integer", minimum: 0 },
        cardIds: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          uniqueItems: true,
          items: { type: "string", minLength: 1, maxLength: 128 },
        },
      },
      required: ["roomId", "expectedRevision", "cardIds"],
      additionalProperties: false,
    },
    uiVisibility: ["app"],
    structuredResult: true,
  },
  {
    name: "ui_pass",
    title: "Pass Human turn",
    description: "MCP App-only: pass the Human's turn when passing is legal for the exact Room revision.",
    inputSchema: {
      type: "object",
      properties: {
        roomId: ROOM_ID_SCHEMA,
        expectedRevision: { type: "integer", minimum: 0 },
      },
      required: ["roomId", "expectedRevision"],
      additionalProperties: false,
    },
    uiVisibility: ["app"],
    structuredResult: true,
  },
  {
    name: "ui_hint",
    title: "Suggest Human move",
    description: "MCP App-only: return the next legal Human card selection hint without mutating the game.",
    inputSchema: {
      type: "object",
      properties: {
        roomId: ROOM_ID_SCHEMA,
        expectedRevision: { type: "integer", minimum: 0 },
        cursor: { type: "integer", minimum: 0, default: 0 },
      },
      required: ["roomId", "expectedRevision"],
      additionalProperties: false,
    },
    uiVisibility: ["app"],
    structuredResult: true,
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

function requiredRoomId(args: Record<string, unknown>): string {
  const value = requiredString(args, "roomId", 128);
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw new Error("roomId contains unsupported characters.");
  return value;
}

function requiredRevision(args: Record<string, unknown>): number {
  const value = args.expectedRevision;
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error("expectedRevision must be a non-negative integer.");
  return value as number;
}

function toolResult(value: unknown, isError = false, structured = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    ...(structured && isRecord(value) ? { structuredContent: value } : {}),
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
      nextAction: "Retry when ready; local Room selections are preserved.",
    };
  }
  if (lower.includes("interactive room") && (lower.includes("not available") || lower.includes("expired"))) {
    return {
      code: "interactive_room_missing",
      message,
      nextAction: "Call open_game() without roomId to start a new Human-controlled table.",
    };
  }
  if (lower.includes("no active waitloop room")) {
    return {
      code: "active_room_missing",
      message,
      nextAction: "Use create_room() or join_room(code) before calling Agent Room tools.",
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
      nextAction: "Retry after connectivity recovers; local Room selections are preserved.",
    };
  }
  return {
    code: "waitloop_error",
    message,
    nextAction: "Refresh Room state before deciding whether to retry a mutation.",
  };
}

function uiMeta(visibility: readonly UiVisibility[]): Record<string, unknown> {
  return {
    ui: {
      resourceUri: WAITLOOP_GAME_UI_URI,
      visibility: [...visibility],
    },
    "ui/resourceUri": WAITLOOP_GAME_UI_URI,
  };
}

function signalForRemoteRead(name: string, signal: AbortSignal | undefined): AbortSignal | undefined {
  return name === "get_turn" || name === "wait_for_turn" || name === "ui_get_game" || name === "ui_hint"
    ? signal
    : undefined;
}

async function callLocalTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  if (name === "open_game") {
    if (args.gameId !== undefined && args.gameId !== "doudizhu") throw new Error("Only gameId doudizhu is currently supported.");
    if (args.mode !== undefined && args.mode !== "human-bots") throw new Error("open_game currently supports mode human-bots.");
    if (args.roomId !== undefined) return getHumanGame(requiredRoomId(args), signalForRemoteRead("ui_get_game", signal));
    return createHumanGame();
  }
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
  if (name === "ui_get_game") return getHumanGame(requiredRoomId(args), signalForRemoteRead(name, signal));
  if (name === "ui_play_cards") {
    return playHumanCards(requiredRoomId(args), requiredRevision(args), args.cardIds);
  }
  if (name === "ui_pass") return passHumanTurn(requiredRoomId(args), requiredRevision(args));
  if (name === "ui_hint") {
    return hintHumanTurn(
      requiredRoomId(args),
      requiredRevision(args),
      args.cursor,
      signalForRemoteRead(name, signal),
    );
  }
  throw new Error(`Unknown Waitloop tool: ${name}`);
}

export function createLocalMcpServer(): McpServer {
  const server = new McpServer(
    { name: "waitloop-local", version: getCliVersion() },
    { instructions: LOCAL_MCP_INSTRUCTIONS },
  );

  server.registerResource(
    "Waitloop Dou Dizhu interactive table",
    WAITLOOP_GAME_UI_URI,
    {
      title: "Waitloop Dou Dizhu",
      description: "Interactive Human-controlled Dou Dizhu table for MCP Apps-capable Agent Hosts.",
      mimeType: MCP_APP_MIME_TYPE,
      _meta: { ui: { prefersBorder: true } },
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: MCP_APP_MIME_TYPE,
        text: WAITLOOP_GAME_APP_HTML,
        _meta: { ui: { prefersBorder: true } },
      }],
    }),
  );

  for (const tool of LOCAL_MCP_TOOLS) {
    server.registerTool(
      tool.name,
      {
        ...(tool.title ? { title: tool.title } : {}),
        description: tool.description,
        inputSchema: fromJsonSchema(tool.inputSchema as Parameters<typeof fromJsonSchema>[0]),
        ...(tool.uiVisibility ? { _meta: uiMeta(tool.uiVisibility) } : {}),
      },
      async (rawArgs, ctx) => {
        try {
          const args = isRecord(rawArgs) ? rawArgs : {};
          const value = await callLocalTool(tool.name, args, ctx.mcpReq.signal);
          return toolResult(value, false, tool.structuredResult === true);
        } catch (error) {
          return toolResult({ error: localToolErrorPayload(error) }, true, tool.structuredResult === true);
        }
      },
    );
  }

  return server;
}

export function runLocalMcpBridge(): void {
  void serveStdio(createLocalMcpServer);
}
