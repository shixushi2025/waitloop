import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { GameRoom, GameRoomSnapshotV1 } from "./game-room";
import {
  classifyWaitForTurn,
  normalizeWaitForTurnTimeout,
  throwIfWaitCancelled,
  WAIT_FOR_TURN_POLL_MS,
  waitForTurnDelay,
} from "./wait-for-turn";

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
    const server = new McpServer({ name: "waitloop", version: "0.2.0" });

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
      "wait_for_turn",
      {
        description:
          "Wait efficiently until your bound seat can act or the room reaches another actionable state. timeoutMs only bounds this tool call; client cancellation stops the wait and never auto-passes, takes over a seat, or changes Casual game state.",
        inputSchema: z.object({
          timeoutMs: z.number().int().min(1_000).max(25_000).optional(),
        }),
      },
      async ({ timeoutMs }, ctx) => {
        let boundedTimeout: number;
        try {
          boundedTimeout = normalizeWaitForTurnTimeout(timeoutMs);
        } catch (error) {
          return errorResult("invalid_wait_timeout", error instanceof Error ? error.message : "Invalid wait timeout.");
        }

        const signal = ctx.mcpReq.signal;
        const startedAt = Date.now();
        let latest: GameRoomSnapshotV1 | null = null;
        while (true) {
          throwIfWaitCancelled(signal);
          const result = await room.getSnapshotBySeatToken(seatToken);
          if (!result.ok) return errorResult(result.error.code, result.error.message);
          latest = rpcValue(result) as GameRoomSnapshotV1;
          const reason = classifyWaitForTurn(latest);
          if (reason) {
            return textResult({
              version: 1,
              reason,
              waitedMs: Date.now() - startedAt,
              snapshot: latest,
            });
          }

          const elapsed = Date.now() - startedAt;
          if (elapsed >= boundedTimeout) {
            return textResult({
              version: 1,
              reason: "timeout",
              waitedMs: elapsed,
              stillWaiting: true,
              snapshot: latest,
            });
          }
          await waitForTurnDelay(Math.min(WAIT_FOR_TURN_POLL_MS, boundedTimeout - elapsed), signal);
        }
      },
    );

    server.registerTool(
      "play_move",
      {
        description:
          "Play one server-generated legal move using the exact room revision from get_turn or wait_for_turn. This succeeds only when this actor is the bound seat's active controller.",
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
