import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { boundedSnapshotWait } from "./bounded-snapshot-wait";
import type { GameRoom, GameRoomSnapshotV1 } from "./game-room";
import {
  classifyWaitForTurn,
  normalizeWaitForTurnTimeout,
  WAIT_FOR_TURN_POLL_MS,
} from "./wait-for-turn";
import {
  classifyWaitForRoomUpdate,
  normalizeAfterRoomSeq,
} from "./wait-for-room-update";

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

  const readSnapshot = async () => {
    const result = await room.getSnapshotBySeatToken(seatToken);
    if (!result.ok) return { ok: false as const, error: result.error };
    return {
      ok: true as const,
      snapshot: rpcValue(result) as GameRoomSnapshotV1,
    };
  };

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
        const result = await readSnapshot();
        if (!result.ok) return errorResult(result.error.code, result.error.message);
        return textResult(result.snapshot);
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

        const wait = await boundedSnapshotWait({
          timeoutMs: boundedTimeout,
          pollMs: WAIT_FOR_TURN_POLL_MS,
          signal: ctx.mcpReq.signal,
          readSnapshot,
          classify: classifyWaitForTurn,
        });
        if (wait.kind === "read_error") {
          return errorResult(wait.error.code, wait.error.message);
        }
        if (wait.kind === "matched") {
          return textResult({
            version: 1,
            reason: wait.reason,
            waitedMs: wait.waitedMs,
            snapshot: wait.snapshot,
          });
        }
        return textResult({
          version: 1,
          reason: "timeout",
          waitedMs: wait.waitedMs,
          stillWaiting: true,
          snapshot: wait.snapshot,
        });
      },
    );

    server.registerTool(
      "wait_for_room_update",
      {
        description:
          "Wait for a semantic Room change after one roomSeq cursor. Controllers and advisors may use it; it does not grant play authority. timeoutMs bounds only this cancellable tool call and cannot wake an Agent run after it has ended.",
        inputSchema: z.object({
          afterRoomSeq: z.number().int().nonnegative(),
          timeoutMs: z.number().int().min(1_000).max(25_000).optional(),
        }),
      },
      async ({ afterRoomSeq, timeoutMs }, ctx) => {
        let cursor: number;
        try {
          cursor = normalizeAfterRoomSeq(afterRoomSeq);
        } catch (error) {
          return errorResult(
            "invalid_room_seq_cursor",
            error instanceof Error ? error.message : "Invalid Room event cursor.",
          );
        }

        let boundedTimeout: number;
        try {
          boundedTimeout = normalizeWaitForTurnTimeout(timeoutMs);
        } catch (error) {
          return errorResult("invalid_wait_timeout", error instanceof Error ? error.message : "Invalid wait timeout.");
        }

        const wait = await boundedSnapshotWait({
          timeoutMs: boundedTimeout,
          pollMs: WAIT_FOR_TURN_POLL_MS,
          signal: ctx.mcpReq.signal,
          readSnapshot,
          classify: (snapshot) => classifyWaitForRoomUpdate(snapshot, cursor),
        });
        if (wait.kind === "read_error") {
          return errorResult(wait.error.code, wait.error.message);
        }
        if (wait.kind === "matched" && wait.reason === "cursor_ahead") {
          return errorResult(
            "room_seq_ahead",
            `afterRoomSeq ${cursor} is ahead of current roomSeq ${wait.snapshot.roomSeq}. Refresh with get_turn before waiting again.`,
          );
        }
        if (wait.kind === "matched") {
          return textResult({
            version: 1,
            reason: wait.reason,
            waitedMs: wait.waitedMs,
            afterRoomSeq: cursor,
            roomSeq: wait.snapshot.roomSeq,
            snapshot: wait.snapshot,
          });
        }
        return textResult({
          version: 1,
          reason: "timeout",
          waitedMs: wait.waitedMs,
          afterRoomSeq: cursor,
          roomSeq: wait.snapshot.roomSeq,
          stillWaiting: true,
          snapshot: wait.snapshot,
        });
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
          "Post a short room comment as this connected actor. Comments are a side channel: they never mutate game rules, turn order, or game revision, but they advance roomSeq for Room observers.",
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
