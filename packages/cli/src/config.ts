import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_WAITLOOP_URL = "http://127.0.0.1:8787";

export interface WaitloopConfig {
  version: 1;
  url: string;
  deviceId: string;
  ingestToken?: string;
  accessToken?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeUrl(input: string): string {
  const value = input.trim();
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Waitloop URL must use http or https.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Waitloop URL must not contain credentials, query parameters, or fragments.");
  }
  const normalizedPath = url.pathname.replace(/\/+$/, "");
  url.pathname = normalizedPath === "/" ? "" : normalizedPath;
  return url.toString().replace(/\/$/, "");
}

export function getConfigPath(): string {
  return process.env.WAITLOOP_CONFIG_PATH || join(homedir(), ".waitloop", "config.json");
}

export async function loadConfig(path = getConfigPath()): Promise<WaitloopConfig | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined;
    if (code === "ENOENT") return null;
    throw error;
  }

  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || parsed.version !== 1) {
    throw new Error(`Invalid Waitloop config at ${path}.`);
  }
  if (typeof parsed.url !== "string" || typeof parsed.deviceId !== "string" || parsed.deviceId.length === 0) {
    throw new Error(`Invalid Waitloop config at ${path}.`);
  }

  const config: WaitloopConfig = {
    version: 1,
    url: normalizeUrl(parsed.url),
    deviceId: parsed.deviceId,
  };
  if (typeof parsed.ingestToken === "string" && parsed.ingestToken.length > 0) {
    config.ingestToken = parsed.ingestToken;
  }
  if (typeof parsed.accessToken === "string" && parsed.accessToken.length > 0) {
    config.accessToken = parsed.accessToken;
  }
  return config;
}

export async function saveConfig(config: WaitloopConfig, path = getConfigPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const body = `${JSON.stringify(config, null, 2)}\n`;
  await writeFile(tempPath, body, { encoding: "utf8", mode: 0o600 });
  await rename(tempPath, path);
}

export function createConfig(input: {
  previous?: WaitloopConfig | null;
  url?: string;
  ingestToken?: string;
  accessToken?: string;
}): WaitloopConfig {
  const config: WaitloopConfig = {
    version: 1,
    url: normalizeUrl(input.url ?? input.previous?.url ?? DEFAULT_WAITLOOP_URL),
    deviceId: input.previous?.deviceId ?? `device-${randomUUID()}`,
  };

  const ingestToken = input.ingestToken ?? input.previous?.ingestToken;
  if (ingestToken) config.ingestToken = ingestToken;
  const accessToken = input.accessToken ?? input.previous?.accessToken;
  if (accessToken) config.accessToken = accessToken;
  return config;
}

export function redactConfig(config: WaitloopConfig): Record<string, unknown> {
  return {
    version: config.version,
    url: config.url,
    deviceId: config.deviceId,
    ingestToken: config.ingestToken ? "configured" : "not configured",
    accessToken: config.accessToken ? "configured" : "not configured",
  };
}
