import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
  finishTurn,
  readHookInput,
  readLatestAgentState,
  startTurn,
  transitionTurn,
  type LocalTurnState,
} from "./lifecycle.js";

export const WAITLOOP_CODEX_HOOK_COMMAND = "waitloop hook codex";
const CODEX_EVENTS = ["UserPromptSubmit", "PermissionRequest", "Stop", "SessionEnd"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getCodexHooksPath(): string {
  return process.env.WAITLOOP_CODEX_HOOKS || join(homedir(), ".codex", "hooks.json");
}

async function readHooks(path: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isRecord(parsed)) throw new Error("Codex hooks file must contain a JSON object.");
    return parsed;
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") {
      return { description: "Waitloop lifecycle hooks.", hooks: {} };
    }
    throw error;
  }
}

async function writeHooks(path: string, value: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

function handler(event: (typeof CODEX_EVENTS)[number]): Record<string, unknown> {
  const value: Record<string, unknown> = {
    type: "command",
    command: WAITLOOP_CODEX_HOOK_COMMAND,
    timeout: event === "SessionEnd" ? 3 : 5,
  };
  if (event !== "SessionEnd") value.async = true;
  return value;
}

function isWaitloopHandler(value: unknown): boolean {
  return isRecord(value) && value.type === "command" && value.command === WAITLOOP_CODEX_HOOK_COMMAND;
}

function ensureHooks(value: Record<string, unknown>): Record<string, unknown> {
  if (value.hooks === undefined) {
    const hooks: Record<string, unknown> = {};
    value.hooks = hooks;
    return hooks;
  }
  if (!isRecord(value.hooks)) throw new Error("Codex `hooks` must be a JSON object.");
  return value.hooks;
}

function installEvent(hooks: Record<string, unknown>, event: (typeof CODEX_EVENTS)[number]): boolean {
  const current = hooks[event];
  if (current !== undefined && !Array.isArray(current)) {
    throw new Error(`Codex hook event ${event} must be an array.`);
  }
  const groups: unknown[] = Array.isArray(current) ? current : [];

  for (const group of groups) {
    if (!isRecord(group) || !Array.isArray(group.hooks)) continue;
    if (group.hooks.some(isWaitloopHandler)) return false;
  }

  groups.push({ hooks: [handler(event)] });
  hooks[event] = groups;
  return true;
}

export async function installCodex(hooksPath = getCodexHooksPath()): Promise<{ changed: boolean; path: string }> {
  const value = await readHooks(hooksPath);
  const hooks = ensureHooks(value);
  let changed = false;
  for (const event of CODEX_EVENTS) changed = installEvent(hooks, event) || changed;
  if (changed) await writeHooks(hooksPath, value);
  return { changed, path: hooksPath };
}

export async function uninstallCodex(hooksPath = getCodexHooksPath()): Promise<{ changed: boolean; path: string }> {
  const value = await readHooks(hooksPath);
  if (!isRecord(value.hooks)) return { changed: false, path: hooksPath };
  const hooks = value.hooks;
  let changed = false;

  for (const event of CODEX_EVENTS) {
    const current = hooks[event];
    if (!Array.isArray(current)) continue;
    const nextGroups: unknown[] = [];

    for (const group of current) {
      if (!isRecord(group) || !Array.isArray(group.hooks)) {
        nextGroups.push(group);
        continue;
      }
      const nextHandlers = group.hooks.filter((item) => !isWaitloopHandler(item));
      if (nextHandlers.length !== group.hooks.length) changed = true;
      if (nextHandlers.length > 0) nextGroups.push({ ...group, hooks: nextHandlers });
    }

    if (nextGroups.length > 0) hooks[event] = nextGroups;
    else if (current.length > 0) delete hooks[event];
  }

  if (Object.keys(hooks).length === 0) delete value.hooks;
  if (changed) await writeHooks(hooksPath, value);
  return { changed, path: hooksPath };
}

export async function runCodexHook(): Promise<void> {
  const input = await readHookInput();
  const sessionId = input?.session_id;
  const hook = input?.hook_event_name;
  if (typeof sessionId !== "string" || typeof hook !== "string") {
    process.stdout.write("{}\n");
    return;
  }

  if (hook === "UserPromptSubmit") {
    await startTurn("codex", sessionId);
  } else if (hook === "PermissionRequest") {
    await transitionTurn("codex", sessionId, "waiting");
  } else if (hook === "Stop" || hook === "SessionEnd") {
    await finishTurn("codex", sessionId, "completed");
  }

  // Valid, no-op hook output: Waitloop observes lifecycle but never steers Codex.
  process.stdout.write("{}\n");
}

export function readLatestCodexState(): Promise<LocalTurnState | null> {
  return readLatestAgentState("codex");
}
