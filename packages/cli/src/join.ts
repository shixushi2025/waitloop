import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { loadConfig, normalizeUrl } from "./config.js";

export const PUBLIC_WAITLOOP_URL = "https://waitloop.run";
const JOIN_CODE_PATTERN = /^WL-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$/;

export type JoinRelationV1 = "controller" | "advisor";

export interface JoinCredentialV1 {
  version: 1;
  code: string;
  roomId: string;
  serverUrl: string;
  joinUrl: string;
  seatToken: string;
  actorId?: string;
  seatId?: string;
  relation?: JoinRelationV1;
  joinExpiresAt?: number;
  roomExpiresAt?: number;
  mcp: {
    type: "http";
    url: string;
    headers: {
      Authorization: string;
      "X-Waitloop-Room": string;
    };
  };
}

interface ActiveJoinPointerV1 {
  version: 1;
  code: string;
  serverUrl: string;
  updatedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalTimestamp(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : undefined;
}

function optionalRelation(value: unknown): JoinRelationV1 | undefined {
  return value === "controller" || value === "advisor" ? value : undefined;
}

export function normalizeJoinCode(input: string): string {
  const value = input.trim().toUpperCase();
  if (!JOIN_CODE_PATTERN.test(value)) throw new Error("Join code must look like WL-XXXXXXXXXX.");
  return value;
}

function joinRoot(): string {
  return process.env.WAITLOOP_JOIN_DIR || join(homedir(), ".waitloop", "joins");
}

function cachePath(code: string): string {
  return join(joinRoot(), `${code}.json`);
}

export function getActiveJoinPath(): string {
  return process.env.WAITLOOP_ACTIVE_JOIN_PATH || join(joinRoot(), "active.json");
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temp, path);
}

async function removeCached(code: string): Promise<void> {
  try {
    await rm(cachePath(code), { force: true });
  } catch {
    // Cache cleanup is best effort; a stale file must never block a fresh claim.
  }
}

function parseCachedCredential(parsed: unknown, code: string, serverUrl: string): JoinCredentialV1 | null {
  if (!isRecord(parsed) || parsed.version !== 1 || parsed.code !== code || parsed.serverUrl !== serverUrl) return null;
  if (typeof parsed.roomId !== "string" || typeof parsed.joinUrl !== "string" || typeof parsed.seatToken !== "string") return null;
  if (!isRecord(parsed.mcp) || parsed.mcp.type !== "http" || typeof parsed.mcp.url !== "string" || !isRecord(parsed.mcp.headers)) return null;
  const authorization = parsed.mcp.headers.Authorization;
  const roomHeader = parsed.mcp.headers["X-Waitloop-Room"];
  if (typeof authorization !== "string" || typeof roomHeader !== "string") return null;

  const actorId = optionalString(parsed.actorId);
  const seatId = optionalString(parsed.seatId);
  const relation = optionalRelation(parsed.relation);
  const joinExpiresAt = optionalTimestamp(parsed.joinExpiresAt);
  const roomExpiresAt = optionalTimestamp(parsed.roomExpiresAt);

  return {
    version: 1,
    code,
    roomId: parsed.roomId,
    serverUrl,
    joinUrl: parsed.joinUrl,
    seatToken: parsed.seatToken,
    ...(actorId ? { actorId } : {}),
    ...(seatId ? { seatId } : {}),
    ...(relation ? { relation } : {}),
    ...(joinExpiresAt ? { joinExpiresAt } : {}),
    ...(roomExpiresAt ? { roomExpiresAt } : {}),
    mcp: {
      type: "http",
      url: parsed.mcp.url,
      headers: {
        Authorization: authorization,
        "X-Waitloop-Room": roomHeader,
      },
    },
  };
}

export async function readCachedJoinCredential(codeInput: string, serverUrlInput: string): Promise<JoinCredentialV1 | null> {
  const code = normalizeJoinCode(codeInput);
  const serverUrl = normalizeUrl(serverUrlInput);
  try {
    const parsed: unknown = JSON.parse(await readFile(cachePath(code), "utf8"));
    const credential = parseCachedCredential(parsed, code, serverUrl);
    if (!credential) return null;
    if (credential.roomExpiresAt !== undefined && credential.roomExpiresAt <= Date.now()) {
      await removeCached(code);
      return null;
    }
    return credential;
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return null;
    return null;
  }
}

async function saveCached(value: JoinCredentialV1): Promise<void> {
  await writePrivateJson(cachePath(value.code), value);
}

function parseClaim(body: unknown, code: string, serverUrl: string): JoinCredentialV1 {
  if (!isRecord(body) || body.version !== 1 || body.code !== code) throw new Error("Waitloop returned an invalid join response.");
  if (typeof body.roomId !== "string" || typeof body.joinUrl !== "string" || typeof body.seatToken !== "string") {
    throw new Error("Waitloop join response is missing the room credential.");
  }
  if (!isRecord(body.mcp) || body.mcp.type !== "http" || typeof body.mcp.url !== "string" || !isRecord(body.mcp.headers)) {
    throw new Error("Waitloop join response is missing MCP configuration.");
  }
  const authorization = body.mcp.headers.Authorization;
  const roomHeader = body.mcp.headers["X-Waitloop-Room"];
  if (typeof authorization !== "string" || typeof roomHeader !== "string") throw new Error("Waitloop MCP headers are invalid.");

  const actorId = optionalString(body.actorId);
  const seatId = optionalString(body.seatId);
  const relation = optionalRelation(body.relation);
  const joinExpiresAt = optionalTimestamp(body.expiresAt);
  const roomExpiresAt = optionalTimestamp(body.roomExpiresAt);

  return {
    version: 1,
    code,
    roomId: body.roomId,
    serverUrl,
    joinUrl: body.joinUrl,
    seatToken: body.seatToken,
    ...(actorId ? { actorId } : {}),
    ...(seatId ? { seatId } : {}),
    ...(relation ? { relation } : {}),
    ...(joinExpiresAt ? { joinExpiresAt } : {}),
    ...(roomExpiresAt ? { roomExpiresAt } : {}),
    mcp: {
      type: "http",
      url: body.mcp.url,
      headers: {
        Authorization: authorization,
        "X-Waitloop-Room": roomHeader,
      },
    },
  };
}

export async function claimJoinCredential(codeInput: string, serverUrlInput: string): Promise<JoinCredentialV1> {
  const code = normalizeJoinCode(codeInput);
  const serverUrl = normalizeUrl(serverUrlInput);
  const cached = await readCachedJoinCredential(code, serverUrl);
  if (cached) return cached;

  const response = await fetch(`${serverUrl}/api/v1/join/${encodeURIComponent(code)}/claim`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ version: 1 }),
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // handled below
  }
  if (!response.ok) {
    const message = isRecord(body) && isRecord(body.error) && typeof body.error.message === "string"
      ? body.error.message
      : `Join failed with HTTP ${response.status}.`;
    throw new Error(message);
  }

  const credential = parseClaim(body, code, serverUrl);
  await saveCached(credential);
  return credential;
}

export async function resolveWaitloopServerUrl(explicitUrl?: string): Promise<string> {
  const config = await loadConfig();
  return normalizeUrl(explicitUrl ?? config?.url ?? PUBLIC_WAITLOOP_URL);
}

export async function setActiveJoinCredential(credential: JoinCredentialV1): Promise<void> {
  const pointer: ActiveJoinPointerV1 = {
    version: 1,
    code: credential.code,
    serverUrl: credential.serverUrl,
    updatedAt: Date.now(),
  };
  await writePrivateJson(getActiveJoinPath(), pointer);
}

export async function clearActiveJoinCredential(): Promise<boolean> {
  try {
    await rm(getActiveJoinPath());
    return true;
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

export async function loadActiveJoinCredential(): Promise<JoinCredentialV1 | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(getActiveJoinPath(), "utf8"));
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return null;
    return null;
  }
  if (!isRecord(parsed) || parsed.version !== 1 || typeof parsed.code !== "string" || typeof parsed.serverUrl !== "string") {
    await clearActiveJoinCredential();
    return null;
  }
  const credential = await readCachedJoinCredential(parsed.code, parsed.serverUrl);
  if (!credential) await clearActiveJoinCredential();
  return credential;
}

export function safeJoinMetadata(credential: JoinCredentialV1) {
  return {
    version: 1,
    code: credential.code,
    roomId: credential.roomId,
    joinUrl: credential.joinUrl,
    ...(credential.actorId ? { actorId: credential.actorId } : {}),
    ...(credential.seatId ? { seatId: credential.seatId } : {}),
    ...(credential.relation ? { relation: credential.relation } : {}),
    ...(credential.roomExpiresAt ? { roomExpiresAt: credential.roomExpiresAt } : {}),
    active: true,
  };
}

export async function commandJoin(codeInput: string | undefined, args: string[]): Promise<void> {
  if (!codeInput) throw new Error("Usage: waitloop join WL-XXXXXXXXXX [--url URL] [--json] [--raw-mcp]");
  const urlIndex = args.indexOf("--url");
  const explicitUrl = urlIndex >= 0 ? args[urlIndex + 1] : undefined;
  if (urlIndex >= 0 && (!explicitUrl || explicitUrl.startsWith("--"))) throw new Error("--url requires a value.");
  const serverUrl = await resolveWaitloopServerUrl(explicitUrl);
  const credential = await claimJoinCredential(codeInput, serverUrl);
  await setActiveJoinCredential(credential);

  const safe = safeJoinMetadata(credential);
  if (args.includes("--json")) {
    console.log(JSON.stringify(safe));
    return;
  }
  if (args.includes("--raw-mcp")) {
    console.log(JSON.stringify({
      ...safe,
      mcpServers: { waitloop: credential.mcp },
    }, null, 2));
    return;
  }

  console.log("waitloop join\n");
  console.log(`code      ${credential.code}`);
  console.log(`room      ${credential.roomId}`);
  if (credential.actorId) console.log(`actor     ${credential.actorId}`);
  if (credential.seatId) console.log(`seat      ${credential.seatId}${credential.relation ? ` · ${credential.relation}` : ""}`);
  console.log(`server    ${serverUrl}`);
  if (credential.roomExpiresAt) console.log(`expires   ${new Date(credential.roomExpiresAt).toISOString()}`);
  console.log("status    credential cached · room is active for the local MCP bridge\n");
  console.log("Use the stable MCP server `waitloop mcp`; credentials stay local and are not printed.");
  console.log("Run with `--raw-mcp` only for an advanced client that cannot use the local bridge.");
}
