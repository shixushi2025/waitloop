import { createHash, randomBytes } from "node:crypto";

import { createConfig, loadConfig, saveConfig, type WaitloopConfig } from "./config.js";

interface DeviceCredentialResponseV1 {
  version: 1;
  deviceId: string;
  deviceToken: string;
  scopes: string[];
}

export interface PairingCreatedV1 {
  pairingId: string;
  code: string;
  pairingUrl: string;
  expiresAt: number;
}

interface PairingCreateResponseV1 extends PairingCreatedV1 {
  version: 1;
  pollAfterMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function responseMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && isRecord(body.error) && typeof body.error.message === "string") return body.error.message;
  } catch {
    // Fall through to a generic status message.
  }
  return `HTTP ${response.status}`;
}

function parseCredentialResponse(value: unknown, expectedDeviceId: string): DeviceCredentialResponseV1 {
  if (!isRecord(value) || value.version !== 1) throw new Error("Waitloop returned an invalid pairing response.");
  if (value.deviceId !== expectedDeviceId) throw new Error("Waitloop returned a credential for a different device.");
  if (typeof value.deviceToken !== "string" || !value.deviceToken.startsWith("wldev_") || value.deviceToken.length < 40) {
    throw new Error("Waitloop returned an invalid device credential.");
  }
  if (!Array.isArray(value.scopes) || !value.scopes.every((scope) => typeof scope === "string") || !value.scopes.includes("agent:write")) {
    throw new Error("Waitloop returned a device credential without the required lifecycle scope.");
  }
  return {
    version: 1,
    deviceId: expectedDeviceId,
    deviceToken: value.deviceToken,
    scopes: value.scopes as string[],
  };
}

function parsePairingCreateResponse(value: unknown, baseUrl: string): PairingCreateResponseV1 {
  if (!isRecord(value) || value.version !== 1) throw new Error("Waitloop returned an invalid pairing request.");
  if (typeof value.pairingId !== "string" || !value.pairingId.startsWith("pair_")) {
    throw new Error("Waitloop returned an invalid pairing ID.");
  }
  if (typeof value.code !== "string" || value.code.length < 4) throw new Error("Waitloop returned an invalid pairing code.");
  if (typeof value.pairingUrl !== "string") throw new Error("Waitloop returned an invalid pairing URL.");
  const pairingUrl = new URL(value.pairingUrl);
  if (pairingUrl.origin !== new URL(baseUrl).origin) throw new Error("Waitloop pairing URL has an unexpected origin.");
  if (typeof value.expiresAt !== "number" || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= Date.now()) {
    throw new Error("Waitloop returned an invalid pairing expiry.");
  }
  const pollAfterMs = typeof value.pollAfterMs === "number" && Number.isFinite(value.pollAfterMs)
    ? Math.max(500, Math.min(5000, Math.floor(value.pollAfterMs)))
    : 1000;
  return {
    version: 1,
    pairingId: value.pairingId,
    code: value.code,
    pairingUrl: pairingUrl.toString(),
    expiresAt: value.expiresAt,
    pollAfterMs,
  };
}

async function ensureConfig(): Promise<WaitloopConfig> {
  const current = await loadConfig();
  if (current) return current;
  const created = createConfig({});
  await saveConfig(created);
  return created;
}

function requestTimeout(): { controller: AbortController; clear: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  return { controller, clear: () => clearTimeout(timeout) };
}

async function saveCredential(config: WaitloopConfig, body: DeviceCredentialResponseV1): Promise<void> {
  const next: WaitloopConfig = { ...config, deviceToken: body.deviceToken };
  delete next.ingestToken;
  await saveConfig(next);
}

async function bootstrapPair(config: WaitloopConfig, bootstrapToken: string): Promise<{ deviceId: string; scopes: string[] }> {
  const timeout = requestTimeout();
  try {
    const response = await fetch(`${config.url}/api/v1/devices/bootstrap`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${bootstrapToken}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ version: 1, deviceId: config.deviceId }),
      signal: timeout.controller.signal,
    });
    if (!response.ok) throw new Error(`Pairing failed: ${await responseMessage(response)}`);

    const body = parseCredentialResponse(await response.json(), config.deviceId);
    await saveCredential(config, body);
    return { deviceId: body.deviceId, scopes: body.scopes };
  } finally {
    timeout.clear();
  }
}

function pairingVerifier(): { verifier: string; verifierHash: string } {
  const verifier = randomBytes(32).toString("base64url");
  const verifierHash = createHash("sha256").update(verifier).digest("hex");
  return { verifier, verifierHash };
}

async function createPublicPairing(config: WaitloopConfig, verifierHash: string): Promise<PairingCreateResponseV1> {
  const timeout = requestTimeout();
  try {
    const response = await fetch(`${config.url}/api/v1/pairings`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ version: 1, deviceId: config.deviceId, verifierHash }),
      signal: timeout.controller.signal,
    });
    if (!response.ok) throw new Error(`Could not create pairing request: ${await responseMessage(response)}`);
    return parsePairingCreateResponse(await response.json(), config.url);
  } finally {
    timeout.clear();
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function exchangePublicPairing(
  config: WaitloopConfig,
  pairing: PairingCreateResponseV1,
  verifier: string,
): Promise<DeviceCredentialResponseV1> {
  while (Date.now() < pairing.expiresAt) {
    const timeout = requestTimeout();
    try {
      const response = await fetch(`${config.url}/api/v1/pairings/${encodeURIComponent(pairing.pairingId)}/exchange`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ version: 1, verifier }),
        signal: timeout.controller.signal,
      });

      if (response.status === 202) {
        // Explicit user approval has not happened yet.
      } else if (response.ok) {
        return parseCredentialResponse(await response.json(), config.deviceId);
      } else {
        throw new Error(`Pairing exchange failed: ${await responseMessage(response)}`);
      }
    } finally {
      timeout.clear();
    }

    await sleep(pairing.pollAfterMs);
  }

  throw new Error("Pairing request expired before it was approved. Run `waitloop pair` again.");
}

export async function pairDevice(input: {
  bootstrapToken?: string;
  onPairingCreated?: (pairing: PairingCreatedV1) => void;
} = {}): Promise<{ deviceId: string; scopes: string[] }> {
  const config = await ensureConfig();
  const bootstrapToken = input.bootstrapToken || process.env.WAITLOOP_BOOTSTRAP_TOKEN;
  if (bootstrapToken) return bootstrapPair(config, bootstrapToken);

  const { verifier, verifierHash } = pairingVerifier();
  const pairing = await createPublicPairing(config, verifierHash);
  input.onPairingCreated?.({
    pairingId: pairing.pairingId,
    code: pairing.code,
    pairingUrl: pairing.pairingUrl,
    expiresAt: pairing.expiresAt,
  });

  const body = await exchangePublicPairing(config, pairing, verifier);
  await saveCredential(config, body);
  return { deviceId: body.deviceId, scopes: body.scopes };
}

export async function unpairDevice(): Promise<{ paired: boolean; revoked: boolean }> {
  const config = await loadConfig();
  if (!config?.deviceToken) return { paired: false, revoked: false };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    let response: Response;
    try {
      response = await fetch(`${config.url}/api/v1/devices/current`, {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${config.deviceToken}`,
          accept: "application/json",
        },
        signal: controller.signal,
      });
    } catch (error) {
      throw new Error(`Could not revoke the device credential; local credential was kept. ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!response.ok && response.status !== 401) {
      throw new Error(`Could not revoke the device credential; local credential was kept. ${await responseMessage(response)}`);
    }

    const next: WaitloopConfig = { ...config };
    delete next.deviceToken;
    await saveConfig(next);
    return { paired: true, revoked: response.ok };
  } finally {
    clearTimeout(timeout);
  }
}
