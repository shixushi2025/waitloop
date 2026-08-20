import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

import {
  callActiveRoomTool,
  createAndActivateHeadlessRoom,
  getActiveRoom,
  joinAndActivateRoom,
  leaveActiveRoom,
  WaitloopClientError,
} from "./room-client.js";
import { getCliVersion } from "./version.js";

interface LocalToolDefinition {
  name: string;
  description: string;
}

export const LOCAL_MCP_INSTRUCTIONS =
  "Waitloop keeps room credentials inside the local bridge. Use create_room for a headless Agent-vs-bots table or join_room with a WL code, then use wait_for_turn instead of polling. If the user asks to play continuously or finish a game, keep the current Agent run active until that stopping condition is reached. MCP cancellation stops the matching tool request and aborts proxied waiting; cancellation never auto-passes or changes Casual game state.";

export const LOCAL_MCP_TOOLS: readonly LocalToolDefinition[] = [
  {
    name: "create_room",
    description:
      "Create and immediately join a headless Dou Dizhu room where this Agent owns seat-1 against two deterministic bots. The bridge calls the Room/Join HTTP APIs internally and keeps credentials local.",
  },
  {
    name: "join_room",
    description:
      "Claim a one-time WL Join code, cache the room Actor credential locally, make it the active room, and authenticate one game request so the Actor is actually connected.",
  },
  {
    name: "get_active_room",
    description: "Return safe metadata and the current snapshot for the bridge's active room. Raw credentials are never returned.",
  },
  {
    name: "leave_room",
    description:
      "Clear the local active-room selection. This does not revoke the cached room credential or mutate the remote game, so an explicit reconnect remains possible until room expiry.",
  },
  {
    name: "get_turn",
    description: "Get the current private projection, public state, capabilities, revision, Controller, and legal move IDs for the active room Actor.",
  },
  {
    name: "wait_for_turn",
    description:
      "Wait until the active room Actor can play or another actionable state occurs. timeoutMs only bounds one tool call and never forces a move or takeover. MCP cancellation aborts the matching wait without returning a stale result.",
  },
  {
    name: "play_move",
    description: "Play one exact server-generated move ID using the current revision for the active room Actor.",
  },
  {
    name: "comment",
    description: "Post a short side-channel comment without mutating game revision, rules, or turn order.",
  },
  {
    name: "yield_to_bot",
    description: "Explicitly let a deterministic temporary Bot control the same owned Seat while preserving owner, hand, role, and history.",
  },
  {
    name: "take_control",
    description: "Explicitly reclaim an owned Seat from its temporary Bot after reconnecting.",
  },
] as const;

function toolDescription(name: string): string {
  const tool = LOCAL_MCP_TOOLS.find((item) => item.name === name);
  if (!tool) throw new Error(`Missing local MCP tool metadata: ${name}`);
  return tool.description;
}

function textResult(value: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    ...(isError ? { isError: true } : {}),
  };
}

export function localToolError(error: unknown) {
  if (error instanceof WaitloopClientError) {
    return textResult({
      error: {
        code: error.code,
        message: error.message,
        ...(error.nextAction ? { nextAction: error.nextAction } : {}),
        ...(error.retrySafe !== undefined ? { retrySafe: error.retrySafe } : {}),
      },
    }, true);
  }
  const message = error instanceof Error ? error.message : String(error);
  return textResult({ error: { code: "waitloop_error", message } }, true);
}

function registerLocalTools(server: McpServer): void {
  server.registerTool(
    "create_room",
    {
      description: toolDescription("create_room"),
      inputSchema: z.object({
        gameId: z.literal("doudizhu").optional(),
        mode: z.literal("agent-bots").optional(),
      }),
    },
    async (_args, ctx) => {
      try {
        return textResult(await createAndActivateHeadlessRoom(undefined, ctx.mcpReq.signal));
      } catch (error) {
        return localToolError(error);
      }
    },
  );

  server.registerTool(
    "join_room",
    {
      description: toolDescription("join_room"),
      inputSchema: z.object({
        code: z.string().regex(/^WL-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$/),
      }),
    },
    async ({ code }, ctx) => {
      try {
        return textResult(await joinAndActivateRoom(code, undefined, ctx.mcpReq.signal));
      } catch (error) {
        return localToolError(error);
      }
    },
  );

  server.registerTool(
    "get_active_room",
    {
      description: toolDescription("get_active_room"),
      inputSchema: z.object({}),
    },
    async (_args, ctx) => {
      try {
        const room = await getActiveRoom(ctx.mcpReq.signal);
        return textResult(room ?? { version: 1, active: false, message: "No active Waitloop room." });
      } catch (error) {
        return localToolError(error);
      }
    },
  );

  server.registerTool(
    "leave_room",
    {
      description: toolDescription("leave_room"),
      inputSchema: z.object({}),
    },
    async () => {
      try {
        return textResult(await leaveActiveRoom());
      } catch (error) {
        return localToolError(error);
      }
    },
  );

  server.registerTool(
    "get_turn",
    {
      description: toolDescription("get_turn"),
      inputSchema: z.object({}),
    },
    async (_args, ctx) => {
      try {
        return textResult(await callActiveRoomTool("get_turn", {}, ctx.mcpReq.signal));
      } catch (error) {
        return localToolError(error);
      }
    },
  );

  server.registerTool(
    "wait_for_turn",
    {
      description: toolDescription("wait_for_turn"),
      inputSchema: z.object({
        timeoutMs: z.number().int().min(1_000).max(25_000).optional(),
      }),
    },
    async ({ timeoutMs }, ctx) => {
      try {
        return textResult(await callActiveRoomTool(
          "wait_for_turn",
          timeoutMs === undefined ? {} : { timeoutMs },
          ctx.mcpReq.signal,
        ));
      } catch (error) {
        return localToolError(error);
      }
    },
  );

  server.registerTool(
    "play_move",
    {
      description: toolDescription("play_move"),
      inputSchema: z.object({
        expectedRevision: z.number().int().nonnegative(),
        moveId: z.string().min(1).max(512),
      }),
    },
    async ({ expectedRevision, moveId }, ctx) => {
      try {
        return textResult(await callActiveRoomTool("play_move", { expectedRevision, moveId }, ctx.mcpReq.signal));
      } catch (error) {
        return localToolError(error);
      }
    },
  );

  server.registerTool(
    "comment",
    {
      description: toolDescription("comment"),
      inputSchema: z.object({
        text: z.string().trim().min(1).max(280),
      }),
    },
    async ({ text }, ctx) => {
      try {
        return textResult(await callActiveRoomTool("comment", { text }, ctx.mcpReq.signal));
      } catch (error) {
        return localToolError(error);
      }
    },
  );

  server.registerTool(
    "yield_to_bot",
    {
      description: toolDescription("yield_to_bot"),
      inputSchema: z.object({}),
    },
    async (_args, ctx) => {
      try {
        return textResult(await callActiveRoomTool("yield_to_bot", {}, ctx.mcpReq.signal));
      } catch (error) {
        return localToolError(error);
      }
    },
  );

  server.registerTool(
    "take_control",
    {
      description: toolDescription("take_control"),
      inputSchema: z.object({}),
    },
    async (_args, ctx) => {
      try {
        return textResult(await callActiveRoomTool("take_control", {}, ctx.mcpReq.signal));
      } catch (error) {
        return localToolError(error);
      }
    },
  );
}

export function createLocalMcpServer(): McpServer {
  const server = new McpServer(
    { name: "waitloop-local", version: getCliVersion() },
    { instructions: LOCAL_MCP_INSTRUCTIONS },
  );
  registerLocalTools(server);
  return server;
}

export async function runLocalMcpBridge(): Promise<void> {
  serveStdio(() => createLocalMcpServer());
}
