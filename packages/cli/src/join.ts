import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { loadConfig, normalizeUrl } from "./config.js";

const PUBLIC_WAITLOOP_URL = "https://waitloop.run";
const JOIN_CODE_PATTERN = /^WL-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$/;

type JoinRelationV1 = "controller" | "advisor";

interface JoinCredentialV1 {
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

function cachePath(code: string): string {
  const root = process.env.WAITLOOP_JOIN_DIR || join(homedir(), ".waitloop", "joins");
  return join(root, `${code}.json`);
}

async function readCached(code: string, serverUrl: string): Promise<JoinCredentialV1 | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(cachePath(code), "utf8"));
    if (!isRecord(parsed) || parsed.version !== 1 || parsed.code !== code || parsed.serverUrl !== serverUrl) return null;
    if (typeof parsed.roomId !== "string" || typeof parsed.joinUrl !== "string" || typeof parsed.seatToken !== "string") return null;
    if (!isRecord(parsed.mcp) || parsed.mcp.type !== "http" || typeof parsed.mcp.url !== "string" || !isRecord(parsed.mcp.headers)) return null;
    const authorization = parsed.mcp.headers.Authorization;
    const roomHeader = parsed.mcp.headers["X-Waitloop-Room"];
    if (typeof authorization !== "string" || typeof roomHeader !== "string") return null;
    return parsed as unknown as JoinCredentialV1;
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return null;
    return null;
  }
}

async function saveCached(value: JoinCredentialV1): Promise<void> {
  const path = cachePath(value.code);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temp, path);
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

async function claim(code: string, serverUrl: string): Promise<JoinCredentialV1> {
  const cached = await readCached(code, serverUrl);
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

export async function commandJoin(codeInput: string | undefined, args: string[]): Promise<void> {
  if (!codeInput) throw new Error("Usage: waitloop join WL-XXXXXXXXXX [--url URL] [--json]");
  const code = normalizeJoinCode(codeInput);
  const urlIndex = args.indexOf("--url");
  const explicitUrl = urlIndex >= 0 ? args[urlIndex + 1] : undefined;
  if (urlIndex >= 0 && (!explicitUrl || explicitUrl.startsWith("--"))) throw new Error("--url requires a value.");
  const config = await loadConfig();
  const serverUrl = normalizeUrl(explicitUrl ?? config?.url ?? PUBLIC_WAITLOOP_URL);
  const credential = await claim(code, serverUrl);

  const output = {
    version: 1,
    code,
    roomId: credential.roomId,
    joinUrl: credential.joinUrl,
    ...(credential.actorId ? { actorId: credential.actorId } : {}),
    ...(credential.seatId ? { seatId: credential.seatId } : {}),
    ...(credential.relation ? { relation: credential.relation } : {}),
    ...(credential.roomExpiresAt ? { roomExpiresAt: credential.roomExpiresAt } : {}),
    mcpServers: {
      waitloop: credential.mcp,
    },
  };

  if (args.includes("--json")) {
    console.log(JSON.stringify(output));
    return;
  }

  console.log("waitloop join\n");
  console.log(`code      ${code}`);
  console.log(`room      ${credential.roomId}`);
  if (credential.actorId) console.log(`actor     ${credential.actorId}`);
  if (credential.seatId) console.log(`seat      ${credential.seatId}${credential.relation ? ` · ${credential.relation}` : ""}`);
  console.log(`server    ${serverUrl}`);
  if (credential.roomExpiresAt) console.log(`expires   ${new Date(credential.roomExpiresAt).toISOString()}`);
  console.log("status    credential cached · connect or reconnect the MCP client\n");
  console.log("mcp/");
  console.log(JSON.stringify({ mcpServers: output.mcpServers }, null, 2));
  console.log("\nThe cached room credential can reconnect this actor while the room remains active.");
  console.log("Use MCP yield_to_bot before stepping away and take_control after reconnecting when you own the seat.");
}
