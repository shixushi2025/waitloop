import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { GameRoom } from "./game-room";

interface McpEnv {
  GAME_ROOMS: DurableObjectNamespace<GameRoom>;
}

function textResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  };
}

function errorResult(code: string, message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: { code, message } }) }],
    isError: true,
  };
}

function rpcValue(result: object): unknown {
  if (!("value" in result)) throw new Error("Successful game RPC result is missing a value.");
  return result.value;
}

function sameOriginOrAbsent(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function handleWaitloopMcp(request: Request, env: McpEnv): Promise<Response> {
  if (!sameOriginOrAbsent(request)) return new Response("Forbidden origin.", { status: 403 });

  const authorization = request.headers.get("authorization");
  const roomId = request.headers.get("x-waitloop-room");
  if (!authorization?.startsWith("Bearer ") || !roomId || roomId.length > 128) {
    return new Response("A room header and actor bearer token are required.", { status: 401 });
  }

  const seatToken = authorization.slice("Bearer ".length);
  const room = env.GAME_ROOMS.getByName(roomId);

  // Every authenticated MCP request refreshes the connected actor's runtime
  // presence. Reconnecting never silently reclaims a seat from a temporary
  // controller; the owner must explicitly call take_control().
  const connected = await room.connectSeatByToken(seatToken);
  if (!connected.ok) {
    const status = connected.error.code === "rate_limited" ? 429 : 401;
    return new Response(connected.error.message, { status });
  }

  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: "waitloop", version: "0.1.0" });

    server.registerTool(
      "get_turn",
      {
        description:
          "Get your current Waitloop room view. A controller can play; an advisor can inspect the bound seat's private hand and legal moves but cannot play until the seat owner delegates control.",
        inputSchema: z.object({}),
      },
      async () => {
        const result = await room.getSnapshotBySeatToken(seatToken);
        if (!result.ok) return errorResult(result.error.code, result.error.message);
        return textResult(rpcValue(result));
      },
    );

    server.registerTool(
      "play_move",
      {
        description:
          "Play one server-generated legal move using the exact room revision from get_turn. This succeeds only when this actor is the bound seat's active controller.",
        inputSchema: z.object({
          expectedRevision: z.number().int().nonnegative(),
          moveId: z.string().min(1).max(512),
        }),
      },
      async ({ expectedRevision, moveId }) => {
        const result = await room.applyMoveBySeatToken(seatToken, expectedRevision, moveId);
        if (!result.ok) return errorResult(result.error.code, result.error.message);
        return textResult(rpcValue(result));
      },
    );

    server.registerTool(
      "comment",
      {
        description:
          "Post a short room comment as this connected actor. Comments are a side channel: they never mutate game rules, turn order, or room revision.",
        inputSchema: z.object({
          text: z.string().trim().min(1).max(280),
        }),
      },
      async ({ text }) => {
        const result = await room.addCommentBySeatToken(seatToken, text);
        if (!result.ok) return errorResult(result.error.code, result.error.message);
        return textResult(rpcValue(result));
      },
    );

    server.registerTool(
      "yield_to_bot",
      {
        description:
          "Temporarily yield your owned seat to a deterministic Waitloop bot. Seat ownership, hand, role, and history stay unchanged; reconnect later and call take_control to resume.",
        inputSchema: z.object({}),
      },
      async () => {
        const result = await room.yieldSeatToBotBySeatToken(seatToken);
        if (!result.ok) return errorResult(result.error.code, result.error.message);
        return textResult(rpcValue(result));
      },
    );

    server.registerTool(
      "take_control",
      {
        description:
          "Reclaim your owned seat after a temporary bot takeover. This does not change the seat's cards, role, ownership, or game history.",
        inputSchema: z.object({}),
      },
      async () => {
        const result = await room.takeControlBySeatToken(seatToken);
        if (!result.ok) return errorResult(result.error.code, result.error.message);
        return textResult(rpcValue(result));
      },
    );

    return server;
  });

  return handler.fetch(request);
}
