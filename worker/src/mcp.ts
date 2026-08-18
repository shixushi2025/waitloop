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
  if (!sameOriginOrAbsent(request)) {
    return new Response("Forbidden origin.", { status: 403 });
  }

  const authorization = request.headers.get("authorization");
  const roomId = request.headers.get("x-waitloop-room");

  if (!authorization?.startsWith("Bearer ") || !roomId || roomId.length > 128) {
    return new Response("A room header and seat bearer token are required.", { status: 401 });
  }

  const seatToken = authorization.slice("Bearer ".length);
  const room = env.GAME_ROOMS.getByName(roomId);
  const authorized = await room.getSnapshotBySeatToken(seatToken);
  if (!authorized.ok) {
    return new Response("Invalid Waitloop room or seat token.", { status: 401 });
  }

  const handler = createMcpHandler(() => {
    const server = new McpServer({
      name: "waitloop",
      version: "0.1.0",
    });

    server.registerTool(
      "get_turn",
      {
        description:
          "Get your current Waitloop game view and server-generated legal moves. Hidden information belonging to other players is never returned.",
        inputSchema: z.object({}),
      },
      async () => {
        const result = await room.getSnapshotBySeatToken(seatToken);
        if (!result.ok) return errorResult(result.error.code, result.error.message);
        return textResult(result.value);
      },
    );

    server.registerTool(
      "play_move",
      {
        description:
          "Play one legal move using the move ID returned by get_turn. Always pass the exact room revision that get_turn returned.",
        inputSchema: z.object({
          expectedRevision: z.number().int().nonnegative(),
          moveId: z.string().min(1).max(512),
        }),
      },
      async ({ expectedRevision, moveId }) => {
        const result = await room.applyMoveBySeatToken(seatToken, expectedRevision, moveId);
        if (!result.ok) return errorResult(result.error.code, result.error.message);
        return textResult(result.value);
      },
    );

    return server;
  });

  return handler.fetch(request);
}
