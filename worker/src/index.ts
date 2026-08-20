import { parseWaitloopAgentEvent } from "@waitloop/protocol";

import { AgentSession } from "./agent-session";
import { actorIdentityFromRequest } from "./actor-identity";
import { DeviceRegistry } from "./device-registry";
import { GameRoom } from "./game-room";
import { listHostedAgents } from "./hosted-agent";
import { apiError, bearerToken, isLocalHostname, isRecord, json, readJson, sha256Hex } from "./http";
import { handleWaitloopMcp } from "./mcp";
import { handlePairingApi } from "./pairing-api";
import { PairingRequest } from "./pairing-request";
import { handleRoomApi, type RoomApiEnv } from "./room-api";

export { AgentSession, DeviceRegistry, GameRoom, PairingRequest };

interface Env extends RoomApiEnv {
  AGENT_SESSIONS: DurableObjectNamespace<AgentSession>;
  DEVICE_AUTH: DurableObjectNamespace<DeviceRegistry>;
  PAIRINGS: DurableObjectNamespace<PairingRequest>;
  ROOM_CREATE_RATE_LIMITER: RateLimit;
  HOSTED_ROOM_CREATE_RATE_LIMITER: RateLimit;
  WAITLOOP_INGEST_TOKEN?: string;
}

interface RoomRateLimitRequest {
  method: string;
  headers: {
    get(name: string): string | null;
  };
  clone(): {
    text(): Promise<string>;
  };
}

const DEVICE_REGISTRY_NAME = "registry-v1";

function deviceRegistry(env: Env) {
  return env.DEVICE_AUTH.getByName(DEVICE_REGISTRY_NAME);
}

function newDeviceToken(): string {
  return `wldev_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
}

function validDeviceId(value: string): boolean {
  return /^[A-Za-z0-9._:-]{1,128}$/.test(value);
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
  if (!env.WAITLOOP_ACCESS_TOKEN) return apiError(503, "access_not_configured", "Private Waitloop APIs are disabled.");
  if (bearerToken(request) !== env.WAITLOOP_ACCESS_TOKEN) return apiError(401, "unauthorized", "A valid access token is required.");
  return null;
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
  if (!validDeviceId(deviceId)) return apiError(400, "invalid_device_id", "deviceId contains unsupported characters or is too long.");

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
  if (!token || !token.startsWith("wldev_")) return apiError(401, "unauthorized", "A valid device credential is required.");

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

async function enforceRoomCreationRateLimit(
  request: RoomRateLimitRequest,
  env: Env,
  url: URL,
): Promise<Response | null> {
  if (request.method !== "POST" || url.pathname !== "/api/v1/rooms" || isLocalHostname(url.hostname)) return null;

  const identity = actorIdentityFromRequest(request);
  const fallbackIp = request.headers.get("cf-connecting-ip") ?? "anonymous-headless";
  const key = identity?.actorId ?? `ip:${fallbackIp}`;
  const roomLimit = await env.ROOM_CREATE_RATE_LIMITER.limit({ key });
  if (!roomLimit.success) return apiError(429, "rate_limited", "Too many room creation requests. Try again shortly.");

  let mode: unknown = null;
  try {
    const text = await request.clone().text();
    if (text.length <= 16 * 1024) {
      const parsed: unknown = JSON.parse(text);
      if (isRecord(parsed)) mode = parsed.mode;
    }
  } catch {
    // The authoritative Room API will report malformed/oversized JSON.
  }

  if (mode === "hosted-agent") {
    const hostedLimit = await env.HOSTED_ROOM_CREATE_RATE_LIMITER.limit({ key });
    if (!hostedLimit.success) {
      return apiError(429, "rate_limited", "Too many hosted-agent rooms. Try again later.");
    }
  }
  return null;
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
    if (url.pathname === "/mcp") return handleWaitloopMcp(request, env);

    const roomRateLimitError = await enforceRoomCreationRateLimit(request, env, url);
    if (roomRateLimitError) return roomRateLimitError;
    const roomResponse = await handleRoomApi(request, env, url);
    if (roomResponse) return roomResponse;

    const sessionRoute = parseSessionRoute(url.pathname);
    if (sessionRoute) return handleSessionRoute(request, env, url, sessionRoute);

    if (request.method === "GET" && isPairPage(url.pathname)) {
      const assetUrl = new URL("/pair.html", url);
      return env.ASSETS.fetch(new Request(assetUrl.toString(), request));
    }

    if (url.pathname.startsWith("/api/")) return apiError(404, "not_found", "The requested API endpoint does not exist.");
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
