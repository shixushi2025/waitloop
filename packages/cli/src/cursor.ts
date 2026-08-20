import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
  finishTurn,
  readHookInput,
  readLatestAgentState,
  startTurn,
  type LocalTurnState,
} from "./lifecycle.js";

export const WAITLOOP_CURSOR_HOOK_COMMAND = "waitloop hook cursor";
const CURSOR_EVENTS = ["beforeSubmitPrompt", "stop", "sessionEnd"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getCursorHooksPath(): string {
  return process.env.WAITLOOP_CURSOR_HOOKS || join(homedir(), ".cursor", "hooks.json");
}

async function readHooks(path: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isRecord(parsed)) throw new Error("Cursor hooks file must contain a JSON object.");
    if (parsed.version !== undefined && parsed.version !== 1) throw new Error("Cursor hooks file must use version 1.");
    return parsed;
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return { version: 1, hooks: {} };
    throw error;
  }
}

async function writeHooks(path: string, value: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

function isWaitloopHandler(value: unknown): boolean {
  return isRecord(value) && value.command === WAITLOOP_CURSOR_HOOK_COMMAND;
}

function ensureHooks(value: Record<string, unknown>): Record<string, unknown> {
  value.version = 1;
  if (value.hooks === undefined) {
    const hooks: Record<string, unknown> = {};
    value.hooks = hooks;
    return hooks;
  }
  if (!isRecord(value.hooks)) throw new Error("Cursor `hooks` must be a JSON object.");
  return value.hooks;
}

export async function installCursor(hooksPath = getCursorHooksPath()): Promise<{ changed: boolean; path: string }> {
  const value = await readHooks(hooksPath);
  const hooks = ensureHooks(value);
  let changed = false;

  for (const event of CURSOR_EVENTS) {
    const current = hooks[event];
    if (current !== undefined && !Array.isArray(current)) throw new Error(`Cursor hook event ${event} must be an array.`);
    const handlers: unknown[] = Array.isArray(current) ? current : [];
    if (handlers.some(isWaitloopHandler)) continue;
    handlers.push({ command: WAITLOOP_CURSOR_HOOK_COMMAND });
    hooks[event] = handlers;
    changed = true;
  }

  if (changed) await writeHooks(hooksPath, value);
  return { changed, path: hooksPath };
}

export async function uninstallCursor(hooksPath = getCursorHooksPath()): Promise<{ changed: boolean; path: string }> {
  const value = await readHooks(hooksPath);
  if (!isRecord(value.hooks)) return { changed: false, path: hooksPath };
  const hooks = value.hooks;
  let changed = false;

  for (const event of CURSOR_EVENTS) {
    const current = hooks[event];
    if (!Array.isArray(current)) continue;
    const next = current.filter((handler) => !isWaitloopHandler(handler));
    if (next.length === current.length) continue;
    changed = true;
    if (next.length > 0) hooks[event] = next;
    else delete hooks[event];
  }

  if (changed) await writeHooks(hooksPath, value);
  return { changed, path: hooksPath };
}

function nativeSessionId(input: Record<string, unknown>): string | null {
  if (typeof input.conversation_id === "string" && input.conversation_id.length > 0) return input.conversation_id;
  if (typeof input.generation_id === "string" && input.generation_id.length > 0) return input.generation_id;
  return null;
}

export async function runCursorHook(): Promise<void> {
  const input = await readHookInput();
  if (!input) {
    process.stdout.write("{}\n");
    return;
  }
  const sessionId = nativeSessionId(input);
  const hook = input.hook_event_name;
  if (!sessionId || typeof hook !== "string") {
    process.stdout.write("{}\n");
    return;
  }

  if (hook === "beforeSubmitPrompt") {
    await startTurn("cursor", sessionId);
  } else if (hook === "stop") {
    const target = input.status === "error" || input.status === "aborted" ? "failed" : "completed";
    await finishTurn("cursor", sessionId, target);
  } else if (hook === "sessionEnd") {
    await finishTurn("cursor", sessionId, "completed");
  }

  process.stdout.write("{}\n");
}

export function readLatestCursorState(): Promise<LocalTurnState | null> {
  return readLatestAgentState("cursor");
}
