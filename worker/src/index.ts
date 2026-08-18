import type { GameMoveCommandV1 } from "@waitloop/game-core";
import { parseWaitloopAgentEvent } from "@waitloop/protocol";

import { AgentSession } from "./agent-session";
import { GameRoom } from "./game-room";
import { handleWaitloopMcp } from "./mcp";

export { AgentSession, GameRoom };

interface Env {
  ASSETS: Fetcher;
  AGENT_SESSIONS: DurableObjectNamespace<AgentSession>;
  GAME_ROOMS: DurableObjectNamespace<GameRoom>;
  WAITLOOP_INGEST_TOKEN?: string;
  WAITLOOP_ACCESS_TOKEN?: string;
}

interface ApiErrorBody {
  version: 1;
  error: { code: string; message: string };
}

const MAX_JSON_BODY_BYTES = 16 * 1024;

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { ...init, headers });
}

function apiError(status: number, code: string, message: string): Response {
  const body: ApiErrorBody = { version: 1, error: { code, message } };
  return json(body, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function bearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  return value?.startsWith("Bearer ") ? value.slice("Bearer ".length) : null;
}

function authorizeAgentMutation(request: Request, env: Env, url: URL): Response | null {
  if (isLocalHostname(url.hostname)) return null;
  if (!env.WAITLOOP_INGEST_TOKEN) {
    return apiError(503, "ingest_not_configured", "Agent event ingestion is disabled.");
  }
  if (bearerToken(request) !== env.WAITLOOP_INGEST_TOKEN) {
    return apiError(401, "unauthorized", "A valid ingest token is required.");
  }
  return null;
}

function authorizePrivateAccess(request: Request, env: Env, url: URL): Response | null {
  if (isLocalHostname(url.hostname)) return null;
  if (!env.WAITLOOP_ACCESS_TOKEN) {
    return apiError(503, "access_not_configured", "Private Waitloop APIs are disabled.");
  }
  if (bearerToken(request) !== env.WAITLOOP_ACCESS_TOKEN) {
    return apiError(401, "unauthorized", "A valid access token is required.");
  }
  return null;
}

async function readJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (Number.isFinite(length) && length > MAX_JSON_BODY_BYTES) {
      return { ok: false, response: apiError(413, "body_too_large", "Request body is too large.") };
    }
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BODY_BYTES) {
    return { ok: false, response: apiError(413, "body_too_large", "Request body is too large.") };
  }

  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, response: apiError(400, "invalid_json", "Request body must contain valid JSON.") };
  }
}

function parseSessionRoute(pathname: string): { sessionId: string; websocket: boolean } | null {
  const match = /^\/api\/v1\/sessions\/([^/]+)(\/ws)?$/.exec(pathname);
  if (!match?.[1]) return null;
  try {
    const sessionId = decodeURIComponent(match[1]);
    if (sessionId.length === 0 || sessionId.length > 128) return null;
    return { sessionId, websocket: match[2] === "/ws" };
  } catch {
    return null;
  }
}

function parseRoomRoute(pathname: string): { roomId: string; action: "snapshot" | "moves" | "ws" | "pause" | "resume" } | null {
  const match = /^\/api\/v1\/rooms\/([^/]+)(?:\/(moves|ws|pause|resume))?$/.exec(pathname);
  if (!match?.[1]) return null;
  try {
    const roomId = decodeURIComponent(match[1]);
    if (roomId.length === 0 || roomId.length > 128) return null;
    const suffix = match[2];
    const action = suffix === "moves" || suffix === "ws" || suffix === "pause" || suffix === "resume" ? suffix : "snapshot";
    return { roomId, action };
  } catch {
    return null;
  }
}

async function handleAgentEvent(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "POST") return apiError(405, "method_not_allowed", "Only POST is allowed.");
  const authError = authorizeAgentMutation(request, env, url);
  if (authError) return authError;

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = parseWaitloopAgentEvent(body.value);
  if (!parsed.ok) return apiError(400, parsed.error.code, parsed.error.message);

  const result = await env.AGENT_SESSIONS.getByName(parsed.value.sessionId).applyEvent(parsed.value);
  return json({
    version: 1,
    accepted: result.accepted,
    changed: result.changed,
    decision: result.decision,
    snapshot: result.snapshot,
  }, { status: result.accepted ? 200 : 409 });
}

async function handleSessionRoute(
  request: Request,
  env: Env,
  url: URL,
  route: { sessionId: string; websocket: boolean },
): Promise<Response> {
  const authError = authorizePrivateAccess(request, env, url);
  if (authError) return authError;
  if (request.method !== "GET") return apiError(405, "method_not_allowed", "Only GET is allowed.");

  const stub = env.AGENT_SESSIONS.getByName(route.sessionId);
  if (route.websocket) return stub.fetch(request);
  const snapshot = await stub.getSnapshot();
  if (!snapshot) return apiError(404, "session_not_found", "No agent session exists for this ID.");
  return json({ version: 1, snapshot });
}

function gameRpcError(code: string, message: string): Response {
  const status = code === "room_not_found" ? 404 : code === "viewer_not_in_room" || code === "player_not_in_room" ? 403 : 409;
  return apiError(status, code, message);
}

function newSeatToken(): string {
  return `wlseat_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
}

async function handleCreateRoom(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "POST") return apiError(405, "method_not_allowed", "Only POST is allowed.");
  const authError = authorizePrivateAccess(request, env, url);
  if (authError) return authError;

  const body = await readJson(request);
  if (!body.ok) return body.response;
  if (!isRecord(body.value) || body.value.version !== 1) {
    return apiError(400, "invalid_room_request", "Room request must be a version 1 object.");
  }

  const { gameId, playerIds, landlordId, viewerId, botPlayerIds, agentPlayerId } = body.value;
  if (gameId !== "doudizhu") return apiError(400, "unknown_game", "Only doudizhu is available in this alpha.");
  if (typeof viewerId !== "string" || viewerId.length === 0) {
    return apiError(400, "invalid_viewer", "viewerId is required.");
  }
  if (!Array.isArray(botPlayerIds) || !botPlayerIds.every((id) => typeof id === "string")) {
    return apiError(400, "invalid_bots", "botPlayerIds must be an array of strings.");
  }

  const seatTokens: Record<string, string> = {};
  let agentSeatToken: string | undefined;
  if (agentPlayerId !== undefined) {
    if (
      typeof agentPlayerId !== "string" ||
      !Array.isArray(playerIds) ||
      !playerIds.includes(agentPlayerId) ||
      botPlayerIds.includes(agentPlayerId)
    ) {
      return apiError(400, "invalid_agent_player", "agentPlayerId must identify a non-bot player in the room.");
    }
    agentSeatToken = newSeatToken();
    seatTokens[agentPlayerId] = agentSeatToken;
  }

  const roomId = `room-${crypto.randomUUID()}`;
  const result = await env.GAME_ROOMS.getByName(roomId).initialize({
    roomId,
    gameId,
    gameInput: { playerIds, landlordId },
    viewerId,
    botPlayerIds,
    seatTokens,
  });
  if (!result.ok) return gameRpcError(result.error.code, result.error.message);

  const response: Record<string, unknown> = {
    version: 1,
    roomId,
    snapshot: result.value,
  };
  if (agentSeatToken) response.agentSeatToken = agentSeatToken;
  return json(response, { status: 201 });
}

async function handleRoomRoute(
  request: Request,
  env: Env,
  url: URL,
  route: { roomId: string; action: "snapshot" | "moves" | "ws" | "pause" | "resume" },
): Promise<Response> {
  const authError = authorizePrivateAccess(request, env, url);
  if (authError) return authError;
  const stub = env.GAME_ROOMS.getByName(route.roomId);

  if (route.action === "ws") {
    if (request.method !== "GET") return apiError(405, "method_not_allowed", "Only GET is allowed.");
    return stub.fetch(request);
  }

  if (route.action === "snapshot") {
    if (request.method !== "GET") return apiError(405, "method_not_allowed", "Only GET is allowed.");
    const viewerId = url.searchParams.get("viewer");
    if (!viewerId) return apiError(400, "invalid_viewer", "viewer query parameter is required.");
    const result = await stub.getSnapshot(viewerId);
    if (!result.ok) return gameRpcError(result.error.code, result.error.message);
    return json({ version: 1, snapshot: result.value });
  }

  const body = await readJson(request);
  if (!body.ok) return body.response;
  if (!isRecord(body.value) || body.value.version !== 1) {
    return apiError(400, "invalid_request", "Request body must be a version 1 object.");
  }

  if (route.action === "moves") {
    if (request.method !== "POST") return apiError(405, "method_not_allowed", "Only POST is allowed.");
    const { playerId, expectedRevision, moveId } = body.value;
    if (typeof playerId !== "string" || typeof moveId !== "string" || !Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0) {
      return apiError(400, "invalid_move", "playerId, expectedRevision, and moveId are required.");
    }
    const command: GameMoveCommandV1 = {
      version: 1,
      roomId: route.roomId,
      playerId,
      expectedRevision: expectedRevision as number,
      moveId,
    };
    const result = await stub.applyMove(command, playerId);
    if (!result.ok) return gameRpcError(result.error.code, result.error.message);
    return json({ version: 1, snapshot: result.value });
  }

  if (request.method !== "POST") return apiError(405, "method_not_allowed", "Only POST is allowed.");
  const viewerId = body.value.viewerId;
  if (typeof viewerId !== "string" || viewerId.length === 0) {
    return apiError(400, "invalid_viewer", "viewerId is required.");
  }
  const result = route.action === "pause" ? await stub.pause(viewerId) : await stub.resume(viewerId);
  if (!result.ok) return gameRpcError(result.error.code, result.error.message);
  return json({ version: 1, snapshot: result.value });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/v1/health") {
      if (request.method !== "GET") return apiError(405, "method_not_allowed", "Only GET is allowed.");
      return json({ version: 1, service: "waitloop", status: "ok" });
    }
    if (url.pathname === "/api/v1/agent-events") return handleAgentEvent(request, env, url);
    if (url.pathname === "/api/v1/rooms") return handleCreateRoom(request, env, url);
    if (url.pathname === "/mcp") return handleWaitloopMcp(request, env);

    const sessionRoute = parseSessionRoute(url.pathname);
    if (sessionRoute) return handleSessionRoute(request, env, url, sessionRoute);

    const roomRoute = parseRoomRoute(url.pathname);
    if (roomRoute) return handleRoomRoute(request, env, url, roomRoute);

    if (url.pathname.startsWith("/api/")) {
      return apiError(404, "not_found", "The requested API endpoint does not exist.");
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
