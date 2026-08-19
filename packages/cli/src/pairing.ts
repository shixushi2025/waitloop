import { createConfig, loadConfig, saveConfig, type WaitloopConfig } from "./config.js";

interface DeviceBootstrapResponseV1 {
  version: 1;
  deviceId: string;
  deviceToken: string;
  scopes: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLocalServer(url: string): boolean {
  const hostname = new URL(url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
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

function parseBootstrapResponse(value: unknown, expectedDeviceId: string): DeviceBootstrapResponseV1 {
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

async function ensureConfig(): Promise<WaitloopConfig> {
  const current = await loadConfig();
  if (current) return current;
  const created = createConfig({});
  await saveConfig(created);
  return created;
}

export async function pairDevice(input: { bootstrapToken?: string } = {}): Promise<{ deviceId: string; scopes: string[] }> {
  const config = await ensureConfig();
  const bootstrapToken = input.bootstrapToken || process.env.WAITLOOP_BOOTSTRAP_TOKEN || config.accessToken;
  if (!bootstrapToken && !isLocalServer(config.url)) {
    throw new Error("Pairing requires WAITLOOP_BOOTSTRAP_TOKEN or --bootstrap-token until browser approval is implemented.");
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (bootstrapToken) headers.authorization = `Bearer ${bootstrapToken}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`${config.url}/api/v1/devices/bootstrap`, {
      method: "POST",
      headers,
      body: JSON.stringify({ version: 1, deviceId: config.deviceId }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Pairing failed: ${await responseMessage(response)}`);

    const body = parseBootstrapResponse(await response.json(), config.deviceId);
    const next: WaitloopConfig = { ...config, deviceToken: body.deviceToken };
    // A successfully paired device no longer needs the Worker-wide lifecycle secret.
    delete next.ingestToken;
    await saveConfig(next);
    return { deviceId: body.deviceId, scopes: body.scopes };
  } finally {
    clearTimeout(timeout);
  }
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

    // 401 means the credential is already invalid remotely, which is safe to remove locally.
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
