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

function ensureHooks(value: Record<string, unknown>): Record<string, unknown> {
  if (value.hooks === undefined) {
    const hooks: Record<string, unknown> = {};
    value.hooks = hooks;
    return hooks;
  }
  if (!isRecord(value.hooks)) throw new Error("Cursor `hooks` must be a JSON object.");
  return value.hooks;
}

function isWaitloopCommand(value: unknown): boolean {
  return isRecord(value) && value.command === WAITLOOP_CURSOR_HOOK_COMMAND;
}

function installEvent(hooks: Record<string, unknown>, event: (typeof CURSOR_EVENTS)[number]): boolean {
  const current = hooks[event];
  if (current !== undefined && !Array.isArray(current)) throw new Error(`Cursor hook event ${event} must be an array.`);
  const commands = Array.isArray(current) ? current : [];
  if (commands.some(isWaitloopCommand)) return false;
  commands.push({ command: WAITLOOP_CURSOR_HOOK_COMMAND });
  hooks[event] = commands;
  return true;
}

export async function installCursor(path = getCursorHooksPath()): Promise<{ changed: boolean; path: string }> {
  const value = await readHooks(path);
  const hooks = ensureHooks(value);
  let changed = false;
  for (const event of CURSOR_EVENTS) changed = installEvent(hooks, event) || changed;
  if (changed) await writeHooks(path, value);
  return { changed, path };
}

export async function uninstallCursor(path = getCursorHooksPath()): Promise<{ changed: boolean; path: string }> {
  const value = await readHooks(path);
  if (!isRecord(value.hooks)) return { changed: false, path };
  let changed = false;
  for (const event of CURSOR_EVENTS) {
    const current = value.hooks[event];
    if (!Array.isArray(current)) continue;
    const next = current.filter((item) => !isWaitloopCommand(item));
    if (next.length !== current.length) changed = true;
    if (next.length > 0) value.hooks[event] = next;
    else delete value.hooks[event];
  }
  if (Object.keys(value.hooks).length === 0) delete value.hooks;
  if (changed) await writeHooks(path, value);
  return { changed, path };
}

function nativeSessionId(input: Record<string, unknown>): string | null {
  if (typeof input.session_id === "string" && input.session_id.length > 0) return input.session_id;
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
