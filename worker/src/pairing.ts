import type { DeviceRegistry } from "./device-registry";
import type { PairingRequest } from "./pairing-request";

interface PairingEnv {
  DEVICE_AUTH: DurableObjectNamespace<DeviceRegistry>;
  PAIRINGS: DurableObjectNamespace<PairingRequest>;
}

export type PairingRouteAction = "status" | "approve" | "exchange";

const PAIRING_TTL_MS = 5 * 60 * 1000;
const MAX_BODY_BYTES = 4 * 1024;
const DEVICE_REGISTRY_NAME = "registry-v1";

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { ...init, headers });
}

function apiError(status: number, code: string, message: string): Response {
  return json({ version: 1, error: { code, message } }, { status });
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

function validVerifierHash(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

function validVerifier(value: string): boolean {
  return /^[A-Za-z0-9_-]{40,128}$/.test(value);
}

function newPairingId(): string {
  return `pair_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > MAX_BODY_BYTES) {
    return { ok: false, response: apiError(413, "body_too_large", "Pairing request body is too large.") };
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return { ok: false, response: apiError(413, "body_too_large", "Pairing request body is too large.") };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, response: apiError(400, "invalid_json", "Request body must contain valid JSON.") };
  }
}

function pairingStub(env: PairingEnv, pairingId: string) {
  return env.PAIRINGS.getByName(pairingId);
}

function deviceRegistry(env: PairingEnv) {
  return env.DEVICE_AUTH.getByName(DEVICE_REGISTRY_NAME);
}

export function parsePairingApiRoute(pathname: string): { pairingId: string; action: PairingRouteAction } | null {
  const match = /^\/api\/v1\/pairings\/(pair_[A-Za-z0-9_-]{32,128})(?:\/(approve|exchange))?$/.exec(pathname);
  if (!match?.[1]) return null;
  return {
    pairingId: match[1],
    action: match[2] === "approve" || match[2] === "exchange" ? match[2] : "status",
  };
}

export async function handleCreatePairing(request: Request, env: PairingEnv, url: URL): Promise<Response> {
  if (request.method !== "POST") return apiError(405, "method_not_allowed", "Only POST is allowed.");
  const body = await readJson(request);
  if (!body.ok) return body.response;
  if (!isRecord(body.value) || body.value.version !== 1) {
    return apiError(400, "invalid_pairing_request", "Pairing request must be a version 1 object.");
  }
  const deviceId = body.value.deviceId;
  const verifierHash = body.value.verifierHash;
  if (typeof deviceId !== "string" || !validDeviceId(deviceId)) {
    return apiError(400, "invalid_device_id", "deviceId is invalid.");
  }
  if (typeof verifierHash !== "string" || !validVerifierHash(verifierHash)) {
    return apiError(400, "invalid_verifier", "verifierHash must be a SHA-256 hex digest.");
  }

  const pairingId = newPairingId();
  const createdAt = Date.now();
  const expiresAt = createdAt + PAIRING_TTL_MS;
  const snapshot = await pairingStub(env, pairingId).initialize({
    version: 1,
    pairingId,
    deviceId,
    verifierHash,
    createdAt,
    expiresAt,
  });

  return json({
    version: 1,
    pairingId,
    deviceId: snapshot.deviceId,
    expiresAt: snapshot.expiresAt,
    approveUrl: `${url.origin}/pair/${pairingId}`,
  }, { status: 201 });
}

function pairingState(snapshot: { expiresAt: number; approvedAt?: number }, now: number): "pending" | "approved" | "expired" {
  if (now > snapshot.expiresAt) return "expired";
  return snapshot.approvedAt === undefined ? "pending" : "approved";
}

export async function handlePairingRoute(
  request: Request,
  env: PairingEnv,
  url: URL,
  route: { pairingId: string; action: PairingRouteAction },
): Promise<Response> {
  if (!validPairingId(route.pairingId)) return apiError(404, "pairing_not_found", "Pairing request not found.");
  const stub = pairingStub(env, route.pairingId);

  if (route.action === "status") {
    if (request.method !== "GET") return apiError(405, "method_not_allowed", "Only GET is allowed.");
    const snapshot = await stub.getSnapshot();
    if (!snapshot) return apiError(404, "pairing_not_found", "Pairing request not found.");
    return json({
      version: 1,
      pairingId: snapshot.pairingId,
      deviceId: snapshot.deviceId,
      expiresAt: snapshot.expiresAt,
      state: pairingState(snapshot, Date.now()),
    });
  }

  if (route.action === "approve") {
    if (request.method !== "POST") return apiError(405, "method_not_allowed", "Only POST is allowed.");
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) return apiError(403, "forbidden_origin", "Pairing approval must be same-origin.");

    const result = await stub.approve(Date.now());
    if ("code" in result) {
      return result.code === "pairing_expired"
        ? apiError(410, result.code, "Pairing request expired.")
        : apiError(404, result.code, "Pairing request not found.");
    }
    return json({
      version: 1,
      pairingId: result.snapshot.pairingId,
      deviceId: result.snapshot.deviceId,
      expiresAt: result.snapshot.expiresAt,
      state: "approved",
    });
  }

  if (request.method !== "POST") return apiError(405, "method_not_allowed", "Only POST is allowed.");
  const body = await readJson(request);
  if (!body.ok) return body.response;
  if (!isRecord(body.value) || body.value.version !== 1 || typeof body.value.verifier !== "string" || !validVerifier(body.value.verifier)) {
    return apiError(400, "invalid_verifier", "A valid version 1 pairing verifier is required.");
  }

  const verifier = body.value.verifier;
  const verifierHash = await sha256Hex(verifier);
  const result = await stub.exchange(verifierHash, Date.now());
  if ("code" in result) {
    if (result.code === "pairing_pending") return apiError(409, result.code, "Pairing request is waiting for browser approval.");
    if (result.code === "pairing_expired") return apiError(410, result.code, "Pairing request expired.");
    if (result.code === "invalid_verifier") return apiError(401, result.code, "Pairing verifier is invalid.");
    return apiError(404, result.code, "Pairing request not found.");
  }

  // Deterministic from a 256-bit verifier so an exchange retry after a lost response
  // yields the same credential without storing the raw credential server-side.
  const tokenMaterial = await sha256Hex(`waitloop-device-v1:${route.pairingId}:${verifier}`);
  const deviceToken = `wldev_${tokenMaterial}`;
  await deviceRegistry(env).issue({
    version: 1,
    deviceId: result.deviceId,
    tokenHash: await sha256Hex(deviceToken),
    scopes: ["agent:write"],
    createdAt: Date.now(),
  });

  return json({
    version: 1,
    pairingId: route.pairingId,
    deviceId: result.deviceId,
    deviceToken,
    scopes: ["agent:write"],
  });
}
