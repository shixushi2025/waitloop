import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { resolveWaitloopServerUrl } from "./join.js";

const ROOM_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const UI_TOKEN_PATTERN = /^wlui_[a-f0-9]{64}$/;
const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const MAX_COOKIE_HEADER_LENGTH = 4_096;

interface HumanRoomSessionV1 {
  version: 1;
  roomId: string;
  serverUrl: string;
  cookieHeader: string;
  uiToken: string;
  createdAt: number;
  expiresAt: number;
}

export interface HumanGamePayloadV1 {
  version: 1;
  kind: "waitloop.mcp-app.game";
  uiVersion: 1;
  gameId: "doudizhu";
  mode: "human-bots";
  roomId: string;
  snapshot: Record<string, unknown>;
  fallback: {
    inlineUiRequired: true;
    webUrl: string;
    sameRoom: false;
    message: string;
  };
}

export interface HumanGameHintPayloadV1 extends HumanGamePayloadV1 {
  hint: {
    version: 1;
    revision: number;
    cardIds: string[];
    label: string;
    index: number;
    total: number;
  };
}

export interface HumanGameAccessV1 {
  payload: HumanGamePayloadV1;
  uiToken: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sessionRoot(): string {
  return process.env.WAITLOOP_APP_ROOM_DIR || join(homedir(), ".waitloop", "app-rooms");
}

function normalizeRoomId(value: string): string {
  if (!ROOM_ID_PATTERN.test(value)) throw new Error("roomId contains unsupported characters or is too long.");
  return value;
}

function sessionPath(roomId: string): string {
  const digest = createHash("sha256").update(normalizeRoomId(roomId)).digest("hex").slice(0, 40);
  return join(sessionRoot(), `${digest}.json`);
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

async function removeSession(roomId: string): Promise<void> {
  try {
    await rm(sessionPath(roomId), { force: true });
  } catch {
    // Stale local UI state must not block a new game.
  }
}

function optionalTimestamp(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : null;
}

function parseSession(value: unknown, expectedRoomId: string): HumanRoomSessionV1 | null {
  if (!isRecord(value) || value.version !== 1 || value.roomId !== expectedRoomId) return null;
  if (typeof value.serverUrl !== "string" || typeof value.cookieHeader !== "string" || typeof value.uiToken !== "string") return null;
  if (value.cookieHeader.length === 0 || value.cookieHeader.length > MAX_COOKIE_HEADER_LENGTH) return null;
  if (!UI_TOKEN_PATTERN.test(value.uiToken)) return null;
  const createdAt = optionalTimestamp(value.createdAt);
  const expiresAt = optionalTimestamp(value.expiresAt);
  if (createdAt === null || expiresAt === null) return null;
  return {
    version: 1,
    roomId: expectedRoomId,
    serverUrl: value.serverUrl,
    cookieHeader: value.cookieHeader,
    uiToken: value.uiToken,
    createdAt,
    expiresAt,
  };
}

async function loadSession(roomIdInput: string): Promise<HumanRoomSessionV1> {
  const roomId = normalizeRoomId(roomIdInput);
  try {
    const value: unknown = JSON.parse(await readFile(sessionPath(roomId), "utf8"));
    const session = parseSession(value, roomId);
    if (!session) throw new Error("Stored interactive Room state is invalid.");
    if (session.expiresAt <= Date.now()) {
      await removeSession(roomId);
      throw new Error("Interactive Room expired. Start a new game with open_game().");
    }
    return session;
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") {
      throw new Error("Interactive Room is not available in this local bridge. Start a new game with open_game().");
    }
    throw error;
  }
}

function tokenMatches(expected: string, provided: string): boolean {
  if (!UI_TOKEN_PATTERN.test(expected) || !UI_TOKEN_PATTERN.test(provided)) return false;
  const expectedBytes = Buffer.from(expected, "utf8");
  const providedBytes = Buffer.from(provided, "utf8");
  return expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes);
}

async function authorizedSession(roomId: string, uiToken: string): Promise<HumanRoomSessionV1> {
  const session = await loadSession(roomId);
  if (!tokenMatches(session.uiToken, uiToken)) throw new Error("Interactive UI capability is invalid.");
  return session;
}

function splitCombinedSetCookie(value: string): string[] {
  return value.split(/,(?=\s*[!#$%&'*+\-.^_`|~0-9A-Za-z]+=)/g);
}

function responseSetCookies(response: Response): string[] {
  const extended = response.headers as Headers & { getSetCookie?: () => string[] };
  const native = extended.getSetCookie?.();
  if (native && native.length > 0) return native;
  const combined = response.headers.get("set-cookie");
  return combined ? splitCombinedSetCookie(combined) : [];
}

function cookieHeader(response: Response): string {
  const cookies: string[] = [];
  for (const header of responseSetCookies(response)) {
    const pair = header.split(";", 1)[0]?.trim();
    if (!pair) continue;
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    if (!COOKIE_NAME_PATTERN.test(name)) continue;
    if (name !== "wl_actor" && !name.startsWith("wl_room_")) continue;
    if (value.length === 0 || /[\r\n;]/.test(value)) continue;
    cookies.push(`${name}=${value}`);
  }
  const result = cookies.join("; ");
  if (!result.includes("wl_actor=") || !result.includes("wl_room_")) {
    throw new Error("Waitloop did not return the private Human Room credentials required by the inline UI.");
  }
  if (result.length > MAX_COOKIE_HEADER_LENGTH) throw new Error("Waitloop returned an oversized Human Room credential.");
  return result;
}

async function responseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function responseMessage(body: unknown, fallback: string): string {
  if (isRecord(body) && isRecord(body.error) && typeof body.error.message === "string") return body.error.message;
  return fallback;
}

function parseSnapshot(value: unknown, expectedRoomId: string): Record<string, unknown> {
  if (!isRecord(value) || value.version !== 1 || value.roomId !== expectedRoomId) {
    throw new Error("Waitloop returned an invalid Human Room snapshot.");
  }
  if (!Number.isSafeInteger(value.revision) || !isRecord(value.state) || !isRecord(value.controls)) {
    throw new Error("Waitloop Human Room snapshot is incomplete.");
  }
  return value;
}

function gamePayload(session: HumanRoomSessionV1, snapshot: Record<string, unknown>): HumanGamePayloadV1 {
  return {
    version: 1,
    kind: "waitloop.mcp-app.game",
    uiVersion: 1,
    gameId: "doudizhu",
    mode: "human-bots",
    roomId: session.roomId,
    snapshot,
    fallback: {
      inlineUiRequired: true,
      webUrl: `${session.serverUrl}/game.html`,
      sameRoom: false,
      message: "This private Human Room is controlled through an MCP App. If this Host cannot render MCP Apps, open the web URL to start a separate browser-controlled game or use create_room() for Agent-owned play.",
    },
  };
}

function gameAccess(session: HumanRoomSessionV1, snapshot: Record<string, unknown>): HumanGameAccessV1 {
  return { payload: gamePayload(session, snapshot), uiToken: session.uiToken };
}

function shouldForget(status: number): boolean {
  return status === 401 || status === 403 || status === 404 || status === 410;
}

async function roomRequest(
  session: HumanRoomSessionV1,
  action: "snapshot" | "play" | "pass" | "hint",
  body?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  const suffix = action === "snapshot" ? "" : `/${action}`;
  const response = await fetch(`${session.serverUrl}/api/v1/rooms/${encodeURIComponent(session.roomId)}${suffix}`, {
    method: action === "snapshot" ? "GET" : "POST",
    headers: {
      accept: "application/json",
      cookie: session.cookieHeader,
      ...(action === "snapshot" ? {} : { "content-type": "application/json" }),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    ...(signal ? { signal } : {}),
  });
  const value = await responseJson(response);
  if (!response.ok) {
    if (shouldForget(response.status)) await removeSession(session.roomId);
    throw new Error(responseMessage(value, `Waitloop Human Room request failed with HTTP ${response.status}.`));
  }
  return value;
}

function expectedRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error("expectedRevision must be a non-negative integer.");
  }
  return value as number;
}

function selectedCardIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    throw new Error("cardIds must contain between 1 and 20 card IDs.");
  }
  if (!value.every((item) => typeof item === "string" && item.length > 0 && item.length <= 128)) {
    throw new Error("cardIds contains an invalid card ID.");
  }
  if (new Set(value).size !== value.length) throw new Error("cardIds must not contain duplicates.");
  return value as string[];
}

export async function createHumanGame(explicitServerUrl?: string): Promise<HumanGameAccessV1> {
  const serverUrl = await resolveWaitloopServerUrl(explicitServerUrl);
  const response = await fetch(`${serverUrl}/api/v1/rooms`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ version: 1, gameId: "doudizhu", mode: "bots" }),
  });
  const body = await responseJson(response);
  if (!response.ok) throw new Error(responseMessage(body, `Waitloop Human Room creation failed with HTTP ${response.status}.`));
  if (!isRecord(body) || body.version !== 1 || typeof body.roomId !== "string") {
    throw new Error("Waitloop Human Room creation returned an invalid response.");
  }
  const roomId = normalizeRoomId(body.roomId);
  const expiresAt = optionalTimestamp(body.expiresAt);
  if (expiresAt === null || expiresAt <= Date.now()) throw new Error("Waitloop Human Room creation returned an invalid expiry.");
  const snapshot = parseSnapshot(body.snapshot, roomId);
  const session: HumanRoomSessionV1 = {
    version: 1,
    roomId,
    serverUrl,
    cookieHeader: cookieHeader(response),
    uiToken: `wlui_${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`,
    createdAt: Date.now(),
    expiresAt,
  };
  await writePrivateJson(sessionPath(roomId), session);
  return gameAccess(session, snapshot);
}

export async function reopenHumanGame(roomId: string, signal?: AbortSignal): Promise<HumanGameAccessV1> {
  const session = await loadSession(roomId);
  const body = await roomRequest(session, "snapshot", undefined, signal);
  if (!isRecord(body)) throw new Error("Waitloop returned an invalid Human Room response.");
  return gameAccess(session, parseSnapshot(body.snapshot, session.roomId));
}

export async function getHumanGame(roomId: string, uiToken: string, signal?: AbortSignal): Promise<HumanGamePayloadV1> {
  const session = await authorizedSession(roomId, uiToken);
  const body = await roomRequest(session, "snapshot", undefined, signal);
  if (!isRecord(body)) throw new Error("Waitloop returned an invalid Human Room response.");
  return gamePayload(session, parseSnapshot(body.snapshot, session.roomId));
}

export async function playHumanCards(
  roomId: string,
  uiToken: string,
  revisionInput: unknown,
  cardIdsInput: unknown,
): Promise<HumanGamePayloadV1> {
  const session = await authorizedSession(roomId, uiToken);
  const body = await roomRequest(session, "play", {
    version: 1,
    expectedRevision: expectedRevision(revisionInput),
    cardIds: selectedCardIds(cardIdsInput),
  });
  if (!isRecord(body)) throw new Error("Waitloop returned an invalid Human play response.");
  return gamePayload(session, parseSnapshot(body.snapshot, session.roomId));
}

export async function passHumanTurn(
  roomId: string,
  uiToken: string,
  revisionInput: unknown,
): Promise<HumanGamePayloadV1> {
  const session = await authorizedSession(roomId, uiToken);
  const body = await roomRequest(session, "pass", {
    version: 1,
    expectedRevision: expectedRevision(revisionInput),
  });
  if (!isRecord(body)) throw new Error("Waitloop returned an invalid Human pass response.");
  return gamePayload(session, parseSnapshot(body.snapshot, session.roomId));
}

export async function hintHumanTurn(
  roomId: string,
  uiToken: string,
  revisionInput: unknown,
  cursorInput: unknown,
  signal?: AbortSignal,
): Promise<HumanGameHintPayloadV1> {
  const cursor = cursorInput === undefined ? 0 : cursorInput;
  if (!Number.isSafeInteger(cursor) || (cursor as number) < 0) throw new Error("cursor must be a non-negative integer.");
  const session = await authorizedSession(roomId, uiToken);
  const hintBody = await roomRequest(session, "hint", {
    version: 1,
    expectedRevision: expectedRevision(revisionInput),
    cursor,
  }, signal);
  if (!isRecord(hintBody) || !isRecord(hintBody.hint)) throw new Error("Waitloop returned an invalid Human hint response.");
  const hint = hintBody.hint;
  if (
    hint.version !== 1 ||
    !Number.isSafeInteger(hint.revision) ||
    !Array.isArray(hint.cardIds) ||
    !hint.cardIds.every((item) => typeof item === "string") ||
    typeof hint.label !== "string" ||
    !Number.isSafeInteger(hint.index) ||
    !Number.isSafeInteger(hint.total)
  ) throw new Error("Waitloop returned an invalid Human hint.");

  const snapshotBody = await roomRequest(session, "snapshot", undefined, signal);
  if (!isRecord(snapshotBody)) throw new Error("Waitloop returned an invalid Human Room response.");
  const current = gamePayload(session, parseSnapshot(snapshotBody.snapshot, session.roomId));
  return { ...current, hint: hint as HumanGameHintPayloadV1["hint"] };
}
