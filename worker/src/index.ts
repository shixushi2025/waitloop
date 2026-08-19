import type { GameMoveCommandV1 } from "@waitloop/game-core";
import { parseWaitloopAgentEvent } from "@waitloop/protocol";

import { AgentSession } from "./agent-session";
import { DeviceRegistry } from "./device-registry";
import { GameRoom } from "./game-room";
import {
  getHostedAgent,
  listHostedAgents,
  type HostedAgentEnv,
} from "./hosted-agent";
import { handleWaitloopMcp } from "./mcp";
import { handlePairingApi } from "./pairing-api";
import { PairingRequest } from "./pairing-request";
import type { GameParticipantV1 } from "./participants";
import { isHostedAgentId } from "./participants";

export { AgentSession, DeviceRegistry, GameRoom, PairingRequest };

interface Env extends HostedAgentEnv {
  ASSETS: Fetcher;
  AGENT_SESSIONS: DurableObjectNamespace<AgentSession>;
  DEVICE_AUTH: DurableObjectNamespace<DeviceRegistry>;
  PAIRINGS: DurableObjectNamespace<PairingRequest>;
  GAME_ROOMS: DurableObjectNamespace<GameRoom>;
  WAITLOOP_INGEST_TOKEN?: string;
  WAITLOOP_ACCESS_TOKEN?: string;
}

interface ApiErrorBody {
  version: 1;
  error: { code: string; message: string };
}

const MAX_JSON_BODY_BYTES = 16 * 1024;
const DEVICE_REGISTRY_NAME = "registry-v1";
const ROOM_COOKIE_MAX_AGE_SECONDS = 6 * 60 * 60;

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

function rpcValue(result: object): unknown {
  if (!("value" in result)) throw new Error("Successful RPC result is missing a value.");
  return result.value;
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function bearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  return value?.startsWith("Bearer ") ? value.slice("Bearer ".length) : null;
}

function deviceRegistry(env: Env) {
  return env.DEVICE_AUTH.getByName(DEVICE_REGISTRY_NAME);
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function newDeviceToken(): string {
  return `wldev_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
}

function newSeatToken(): string {
  return `wlseat_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
}

function newViewerToken(): string {
  return `wlview_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
}

function validDeviceId(value: string): boolean {
  return /^[A-Za-z0-9._:-]{1,128}$/.test(value);
}

function roomCookieName(roomId: string): string {
  return `wl_room_${roomId.replace(/[^A-Za-z0-9]/g, "_")}`;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const item of header.split(";")) {
    const index = item.indexOf("=");
    if (index < 0) continue;
    if (item.slice(0, index).trim() === name) return item.slice(index + 1).trim();
  }
  return null;
}

function roomViewerToken(request: Request, roomId: string): string | null {
  const value = readCookie(request, roomCookieName(roomId));
  return value?.startsWith("wlview_") ? value : null;
}

function roomCookie(roomId: string, viewerToken: string, url: URL): string {
  const parts = [
    `${roomCookieName(roomId)}=${viewerToken}`,
    `Path=/api/v1/rooms/${roomId}`,
    `Max-Age=${ROOM_COOKIE_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (url.protocol === "https:") parts.push("Secure");
  return parts.join("; ");
}

async function authorizeAgentMutation(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (isLocalHostname(url.hostname)) return null;
  const token = bearerToken(request);
  if (!token) return apiError(401, "unauthorized", "A lifecycle credential is required.");

  if (token.startsWith("wldev_")) {
    const authorization = await deviceRegistry(env).authorize(await sha256Hex(token), "agent:write");
    if (authorization.ok) return null;
  }

  if (env.WAITLOOP_INGEST_TOKEN && token === env.WAITLOOP_INGEST_TOKEN) return null;
  return apiError(401, "unauthorized", "A valid lifecycle credential is required.");
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
  const authError = await authorizeAgentMutation(request, env, url);
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

async function handleDeviceBootstrap(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "POST") return apiError(405, "method_not_allowed", "Only POST is allowed.");
  const authError = authorizePrivateAccess(request, env, url);
  if (authError) return authError;

  const body = await readJson(request);
  if (!body.ok) return body.response;
  if (!isRecord(body.value) || body.value.version !== 1 || typeof body.value.deviceId !== "string") {
    return apiError(400, "invalid_device_request", "Device bootstrap requires a version 1 deviceId.");
  }
  const deviceId = body.value.deviceId;
  if (!validDeviceId(deviceId)) {
    return apiError(400, "invalid_device_id", "deviceId contains unsupported characters or is too long.");
  }

  const deviceToken = newDeviceToken();
  await deviceRegistry(env).issue({
    version: 1,
    deviceId,
    tokenHash: await sha256Hex(deviceToken),
    scopes: ["agent:write"],
    createdAt: Date.now(),
  });

  return json({ version: 1, deviceId, deviceToken, scopes: ["agent:write"] }, { status: 201 });
}

async function handleCurrentDevice(request: Request, env: Env): Promise<Response> {
  if (request.method !== "DELETE") return apiError(405, "method_not_allowed", "Only DELETE is allowed.");
  const token = bearerToken(request);
  if (!token || !token.startsWith("wldev_")) {
    return apiError(401, "unauthorized", "A valid device credential is required.");
  }

  const result = await deviceRegistry(env).revoke(await sha256Hex(token));
  if (!result.revoked) return apiError(401, "unauthorized", "The device credential is invalid or already revoked.");
  return json({ version: 1, revoked: true, deviceId: result.deviceId });
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
  const forbidden = code === "viewer_not_in_room" || code === "player_not_in_room" || code === "invalid_viewer_token" || code === "invalid_seat_token";
  const status = code === "room_not_found" ? 404 : forbidden ? 403 : 409;
  return apiError(status, code, message);
}

type RoomMode = "bots" | "hosted-agent" | "connected-agent";

function roomMode(value: Record<string, unknown>): RoomMode | null {
  if (value.mode === "bots" || value.mode === "hosted-agent" || value.mode === "connected-agent") return value.mode;
  // Backward compatibility for the first alpha web client.
  if (typeof value.agentPlayerId === "string") return "connected-agent";
  if (Array.isArray(value.botPlayerIds)) return "bots";
  return null;
}

async function handleCreateRoom(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "POST") return apiError(405, "method_not_allowed", "Only POST is allowed.");

  const body = await readJson(request);
  if (!body.ok) return body.response;
  if (!isRecord(body.value) || body.value.version !== 1 || body.value.gameId !== "doudizhu") {
    return apiError(400, "invalid_room_request", "A version 1 doudizhu room request is required.");
  }

  const mode = roomMode(body.value);
  if (!mode) return apiError(400, "invalid_room_mode", "Choose bots, hosted-agent, or connected-agent.");

  const viewerId = "you";
  let playerIds: [string, string, string];
  let botPlayerIds: string[];
  let participants: GameParticipantV1[];
  const seatTokens: Record<string, string> = {};
  const hostedAgents: Parameters<GameRoom["initialize"]>[0]["hostedAgents"] = {};
  let agentSeatToken: string | undefined;

  if (mode === "bots") {
    playerIds = [viewerId, "bot-a", "bot-b"];
    botPlayerIds = ["bot-a", "bot-b"];
    participants = [
      { version: 1, id: viewerId, kind: "human", label: "you" },
      { version: 1, id: "bot-a", kind: "bot", label: "bot a" },
      { version: 1, id: "bot-b", kind: "bot", label: "bot b" },
    ];
  } else if (mode === "hosted-agent") {
    if (!isHostedAgentId(body.value.hostedAgentId)) {
      return apiError(400, "invalid_hosted_agent", "hostedAgentId must identify an available hosted agent.");
    }
    const hostedAgent = getHostedAgent(env, body.value.hostedAgentId);
    if (!hostedAgent) {
      return apiError(503, "hosted_agent_unavailable", "That hosted agent is not configured on this deployment.");
    }
    const hostedPlayerId = `hosted-${hostedAgent.id}`;
    playerIds = [viewerId, hostedPlayerId, "bot"];
    botPlayerIds = ["bot"];
    participants = [
      { version: 1, id: viewerId, kind: "human", label: "you" },
      {
        version: 1,
        id: hostedPlayerId,
        kind: "hosted-agent",
        label: hostedAgent.label,
        hostedAgentId: hostedAgent.id,
        provider: hostedAgent.provider,
        model: hostedAgent.model,
      },
      { version: 1, id: "bot", kind: "bot", label: "bot" },
    ];
    hostedAgents[hostedPlayerId] = hostedAgent;
  } else {
    const connectedPlayerId = "connected-agent";
    playerIds = [viewerId, connectedPlayerId, "bot"];
    botPlayerIds = ["bot"];
    participants = [
      { version: 1, id: viewerId, kind: "human", label: "you" },
      { version: 1, id: connectedPlayerId, kind: "connected-agent", label: "connected agent" },
      { version: 1, id: "bot", kind: "bot", label: "bot" },
    ];
    agentSeatToken = newSeatToken();
    seatTokens[connectedPlayerId] = agentSeatToken;
  }

  const roomId = `room-${crypto.randomUUID()}`;
  const viewerToken = newViewerToken();
  const result = await env.GAME_ROOMS.getByName(roomId).initialize({
    roomId,
    gameId: "doudizhu",
    gameInput: { playerIds, landlordId: viewerId },
    viewerId,
    botPlayerIds,
    seatTokens,
    viewerTokens: { [viewerId]: viewerToken },
    participants,
    hostedAgents,
  });
  if (!result.ok) return gameRpcError(result.error.code, result.error.message);

  const response: Record<string, unknown> = {
    version: 1,
    roomId,
    mode,
    snapshot: rpcValue(result),
  };
  if (agentSeatToken) response.agentSeatToken = agentSeatToken;

  return json(response, {
    status: 201,
    headers: { "set-cookie": roomCookie(roomId, viewerToken, url) },
  });
}

async function handleRoomRoute(
  request: Request,
  env: Env,
  url: URL,
  route: { roomId: string; action: "snapshot" | "moves" | "ws" | "pause" | "resume" },
): Promise<Response> {
  const stub = env.GAME_ROOMS.getByName(route.roomId);
  const viewerToken = roomViewerToken(request, route.roomId);

  if (route.action === "ws") {
    if (request.method !== "GET") return apiError(405, "method_not_allowed", "Only GET is allowed.");
    if (viewerToken) {
      const headers = new Headers(request.headers);
      headers.set("x-waitloop-viewer-token", viewerToken);
      return stub.fetch(new Request(request, { headers }));
    }
    const authError = authorizePrivateAccess(request, env, url);
    if (authError) return authError;
    return stub.fetch(request);
  }

  if (route.action === "snapshot") {
    if (request.method !== "GET") return apiError(405, "method_not_allowed", "Only GET is allowed.");
    if (viewerToken) {
      const result = await stub.getSnapshotByViewerToken(viewerToken);
      if (!result.ok) return gameRpcError(result.error.code, result.error.message);
      return json({ version: 1, snapshot: rpcValue(result) });
    }
    const authError = authorizePrivateAccess(request, env, url);
    if (authError) return authError;
    const viewerId = url.searchParams.get("viewer");
    if (!viewerId) return apiError(400, "invalid_viewer", "viewer query parameter is required.");
    const result = await stub.getSnapshot(viewerId);
    if (!result.ok) return gameRpcError(result.error.code, result.error.message);
    return json({ version: 1, snapshot: rpcValue(result) });
  }

  const body = await readJson(request);
  if (!body.ok) return body.response;
  if (!isRecord(body.value) || body.value.version !== 1) {
    return apiError(400, "invalid_request", "Request body must be a version 1 object.");
  }

  if (route.action === "moves") {
    if (request.method !== "POST") return apiError(405, "method_not_allowed", "Only POST is allowed.");
    const { expectedRevision, moveId } = body.value;
    if (typeof moveId !== "string" || !Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0) {
      return apiError(400, "invalid_move", "expectedRevision and moveId are required.");
    }

    if (viewerToken) {
      const result = await stub.applyMoveByViewerToken(viewerToken, expectedRevision as number, moveId);
      if (!result.ok) return gameRpcError(result.error.code, result.error.message);
      return json({ version: 1, snapshot: rpcValue(result) });
    }

    const authError = authorizePrivateAccess(request, env, url);
    if (authError) return authError;
    const playerId = body.value.playerId;
    if (typeof playerId !== "string") return apiError(400, "invalid_move", "playerId is required for private access.");
    const command: GameMoveCommandV1 = {
      version: 1,
      roomId: route.roomId,
      playerId,
      expectedRevision: expectedRevision as number,
      moveId,
    };
    const result = await stub.applyMove(command, playerId);
    if (!result.ok) return gameRpcError(result.error.code, result.error.message);
    return json({ version: 1, snapshot: rpcValue(result) });
  }

  if (request.method !== "POST") return apiError(405, "method_not_allowed", "Only POST is allowed.");
  if (viewerToken) {
    const result = route.action === "pause"
      ? await stub.pauseByViewerToken(viewerToken)
      : await stub.resumeByViewerToken(viewerToken);
    if (!result.ok) return gameRpcError(result.error.code, result.error.message);
    return json({ version: 1, snapshot: rpcValue(result) });
  }

  const authError = authorizePrivateAccess(request, env, url);
  if (authError) return authError;
  const viewerId = body.value.viewerId;
  if (typeof viewerId !== "string" || viewerId.length === 0) {
    return apiError(400, "invalid_viewer", "viewerId is required for private access.");
  }
  const result = route.action === "pause" ? await stub.pause(viewerId) : await stub.resume(viewerId);
  if (!result.ok) return gameRpcError(result.error.code, result.error.message);
  return json({ version: 1, snapshot: rpcValue(result) });
}

function isPairPage(pathname: string): boolean {
  return /^\/pair\/pair_[A-Za-z0-9_-]{32,128}$/.test(pathname);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const pairingResponse = await handlePairingApi(request, env, url);
    if (pairingResponse) return pairingResponse;

    if (url.pathname === "/api/v1/health") {
      if (request.method !== "GET") return apiError(405, "method_not_allowed", "Only GET is allowed.");
      return json({ version: 1, service: "waitloop", status: "ok" });
    }
    if (url.pathname === "/api/v1/hosted-agents") {
      if (request.method !== "GET") return apiError(405, "method_not_allowed", "Only GET is allowed.");
      return json({ version: 1, agents: listHostedAgents(env) });
    }
    if (url.pathname === "/api/v1/agent-events") return handleAgentEvent(request, env, url);
    if (url.pathname === "/api/v1/devices/bootstrap") return handleDeviceBootstrap(request, env, url);
    if (url.pathname === "/api/v1/devices/current") return handleCurrentDevice(request, env);
    if (url.pathname === "/api/v1/rooms") return handleCreateRoom(request, env, url);
    if (url.pathname === "/mcp") return handleWaitloopMcp(request, env);

    const sessionRoute = parseSessionRoute(url.pathname);
    if (sessionRoute) return handleSessionRoute(request, env, url, sessionRoute);

    const roomRoute = parseRoomRoute(url.pathname);
    if (roomRoute) return handleRoomRoute(request, env, url, roomRoute);

    if (request.method === "GET" && isPairPage(url.pathname)) {
      const assetUrl = new URL("/pair.html", url);
      return env.ASSETS.fetch(new Request(assetUrl.toString(), request));
    }

    if (url.pathname.startsWith("/api/")) {
      return apiError(404, "not_found", "The requested API endpoint does not exist.");
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
