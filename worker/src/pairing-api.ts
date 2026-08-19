import type { DeviceRegistry } from "./device-registry";
import type { PairingRequest } from "./pairing-request";

interface PairingEnv {
  DEVICE_AUTH: DurableObjectNamespace<DeviceRegistry>;
  PAIRINGS: DurableObjectNamespace<PairingRequest>;
}

interface ApiErrorBody {
  version: 1;
  error: { code: string; message: string };
}

const DEVICE_REGISTRY_NAME = "registry-v1";
const PAIRING_TTL_MS = 5 * 60 * 1000;
const MAX_BODY_BYTES = 4 * 1024;

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

function validDeviceId(value: string): boolean {
  return /^[A-Za-z0-9._:-]{1,128}$/.test(value);
}

function validPairingId(value: string): boolean {
  return /^pair_[A-Za-z0-9_-]{32,128}$/.test(value);
}

function validHash(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

function newPairingId(): string {
  return `pair_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
}

function newDeviceToken(): string {
  return `wldev_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return { ok: false, response: apiError(413, "body_too_large", "Request body is too large.") };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, response: apiError(400, "invalid_json", "Request body must contain valid JSON.") };
  }
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

function parsePairingRoute(pathname: string): { pairingId: string; action: "status" | "approve" | "exchange" } | null {
  const match = /^\/api\/v1\/pairings\/([^/]+)(?:\/(approve|exchange))?$/.exec(pathname);
  if (!match?.[1]) return null;
  try {
    const pairingId = decodeURIComponent(match[1]);
    if (!validPairingId(pairingId)) return null;
    const suffix = match[2];
    return { pairingId, action: suffix === "approve" || suffix === "exchange" ? suffix : "status" };
  } catch {
    return null;
  }
}

function publicCode(pairingId: string): string {
  const body = pairingId.slice("pair_".length).toUpperCase();
  return `${body.slice(0, 4)}-${body.slice(4, 8)}`;
}

async function createPairing(request: Request, env: PairingEnv, url: URL): Promise<Response> {
  if (request.method !== "POST") return apiError(405, "method_not_allowed", "Only POST is allowed.");
  const body = await readJson(request);
  if (!body.ok) return body.response;
  if (!isRecord(body.value) || body.value.version !== 1) {
    return apiError(400, "invalid_pairing_request", "Pairing request must be a version 1 object.");
  }

  const deviceId = body.value.deviceId;
  const verifierHash = body.value.verifierHash;
  if (typeof deviceId !== "string" || !validDeviceId(deviceId)) {
    return apiError(400, "invalid_device_id", "deviceId contains unsupported characters or is too long.");
  }
  if (typeof verifierHash !== "string" || !validHash(verifierHash)) {
    return apiError(400, "invalid_verifier", "verifierHash must be a SHA-256 hex digest.");
  }

  const pairingId = newPairingId();
  const now = Date.now();
  const expiresAt = now + PAIRING_TTL_MS;
  await env.PAIRINGS.getByName(pairingId).initialize({
    version: 1,
    pairingId,
    deviceId,
    verifierHash,
    createdAt: now,
    expiresAt,
  });

  const pairingUrl = new URL(`/pair/${encodeURIComponent(pairingId)}`, url.origin).toString();
  return json({
    version: 1,
    pairingId,
    code: publicCode(pairingId),
    pairingUrl,
    expiresAt,
    pollAfterMs: 1000,
  }, { status: 201 });
}

async function getPairing(env: PairingEnv, pairingId: string): Promise<Response> {
  const snapshot = await env.PAIRINGS.getByName(pairingId).getSnapshot();
  if (!snapshot) return apiError(404, "pairing_not_found", "Pairing request does not exist.");
  if (Date.now() > snapshot.expiresAt) return apiError(410, "pairing_expired", "Pairing request has expired.");
  return json({
    version: 1,
    pairingId: snapshot.pairingId,
    code: publicCode(snapshot.pairingId),
    deviceId: snapshot.deviceId,
    createdAt: snapshot.createdAt,
    expiresAt: snapshot.expiresAt,
    approved: snapshot.approvedAt !== undefined,
    exchanged: snapshot.exchangedAt !== undefined,
  });
}

async function approvePairing(request: Request, env: PairingEnv, pairingId: string): Promise<Response> {
  if (request.method !== "POST") return apiError(405, "method_not_allowed", "Only POST is allowed.");
  if (!sameOriginOrAbsent(request)) return apiError(403, "forbidden_origin", "Pairing approval must come from Waitloop.");

  const result = await env.PAIRINGS.getByName(pairingId).approve(Date.now());
  if (!result.ok) {
    return result.code === "pairing_expired"
      ? apiError(410, result.code, "Pairing request has expired.")
      : apiError(404, result.code, "Pairing request does not exist.");
  }
  return json({ version: 1, approved: true, pairingId, approvedAt: result.snapshot.approvedAt });
}

async function exchangePairing(request: Request, env: PairingEnv, pairingId: string): Promise<Response> {
  if (request.method !== "POST") return apiError(405, "method_not_allowed", "Only POST is allowed.");
  const body = await readJson(request);
  if (!body.ok) return body.response;
  if (!isRecord(body.value) || body.value.version !== 1 || typeof body.value.verifier !== "string") {
    return apiError(400, "invalid_exchange", "Exchange requires a version 1 verifier.");
  }

  const verifier = body.value.verifier;
  if (verifier.length < 32 || verifier.length > 256) {
    return apiError(400, "invalid_verifier", "Pairing verifier is invalid.");
  }

  const result = await env.PAIRINGS.getByName(pairingId).exchange(await sha256Hex(verifier), Date.now());
  if (!result.ok) {
    if (result.code === "pairing_pending") return json({ version: 1, status: "pending" }, { status: 202 });
    if (result.code === "pairing_expired") return apiError(410, result.code, "Pairing request has expired.");
    if (result.code === "pairing_consumed") return apiError(409, result.code, "Pairing request was already used.");
    if (result.code === "invalid_verifier") return apiError(401, result.code, "Pairing verifier is invalid.");
    return apiError(404, result.code, "Pairing request does not exist.");
  }

  const deviceToken = newDeviceToken();
  await env.DEVICE_AUTH.getByName(DEVICE_REGISTRY_NAME).issue({
    version: 1,
    deviceId: result.deviceId,
    tokenHash: await sha256Hex(deviceToken),
    scopes: ["agent:write"],
    createdAt: Date.now(),
  });

  return json({
    version: 1,
    deviceId: result.deviceId,
    deviceToken,
    scopes: ["agent:write"],
  });
}

export async function handlePairingApi(request: Request, env: PairingEnv, url: URL): Promise<Response | null> {
  if (url.pathname === "/api/v1/pairings") return createPairing(request, env, url);

  const route = parsePairingRoute(url.pathname);
  if (!route) return null;
  if (route.action === "status") {
    if (request.method !== "GET") return apiError(405, "method_not_allowed", "Only GET is allowed.");
    return getPairing(env, route.pairingId);
  }
  if (route.action === "approve") return approvePairing(request, env, route.pairingId);
  return exchangePairing(request, env, route.pairingId);
}
