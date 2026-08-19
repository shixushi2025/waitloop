import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export const WAITLOOP_CLAUDE_HOOK_COMMAND = "waitloop hook claude-code";

interface HookSpec {
  event: string;
  matcher: string;
}

const HOOK_SPECS: HookSpec[] = [
  { event: "UserPromptSubmit", matcher: "" },
  { event: "PermissionRequest", matcher: "" },
  { event: "Notification", matcher: "permission_prompt|idle_prompt|elicitation_dialog" },
  { event: "Stop", matcher: "" },
  { event: "StopFailure", matcher: "" },
  { event: "SessionEnd", matcher: "" },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getClaudeSettingsPath(): string {
  return process.env.WAITLOOP_CLAUDE_SETTINGS || join(homedir(), ".claude", "settings.json");
}

async function readSettings(path: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isRecord(parsed)) throw new Error("Claude settings must contain a JSON object.");
    return parsed;
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return {};
    throw error;
  }
}

async function writeSettings(path: string, settings: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

function hookHandler(): Record<string, unknown> {
  return {
    type: "command",
    command: WAITLOOP_CLAUDE_HOOK_COMMAND,
    async: true,
    timeout: 5,
  };
}

function isWaitloopHandler(value: unknown): boolean {
  return isRecord(value) && value.type === "command" && value.command === WAITLOOP_CLAUDE_HOOK_COMMAND;
}

function ensureHooksObject(settings: Record<string, unknown>): Record<string, unknown> {
  if (settings.hooks === undefined) {
    const hooks: Record<string, unknown> = {};
    settings.hooks = hooks;
    return hooks;
  }
  if (!isRecord(settings.hooks)) throw new Error("Claude settings `hooks` must be a JSON object.");
  return settings.hooks;
}

function installEvent(hooks: Record<string, unknown>, spec: HookSpec): boolean {
  const rawGroups = hooks[spec.event];
  if (rawGroups !== undefined && !Array.isArray(rawGroups)) {
    throw new Error(`Claude hook event ${spec.event} must be an array.`);
  }
  const groups: unknown[] = Array.isArray(rawGroups) ? rawGroups : [];

  for (const group of groups) {
    if (!isRecord(group)) continue;
    const matcher = typeof group.matcher === "string" ? group.matcher : "";
    const handlers = group.hooks;
    if (matcher !== spec.matcher || !Array.isArray(handlers)) continue;
    if (handlers.some(isWaitloopHandler)) return false;
    handlers.push(hookHandler());
    hooks[spec.event] = groups;
    return true;
  }

  groups.push({ matcher: spec.matcher, hooks: [hookHandler()] });
  hooks[spec.event] = groups;
  return true;
}

export async function installClaudeCode(settingsPath = getClaudeSettingsPath()): Promise<{ changed: boolean; path: string }> {
  const settings = await readSettings(settingsPath);
  const hooks = ensureHooksObject(settings);
  let changed = false;
  for (const spec of HOOK_SPECS) changed = installEvent(hooks, spec) || changed;
  if (changed) await writeSettings(settingsPath, settings);
  return { changed, path: settingsPath };
}

export async function uninstallClaudeCode(settingsPath = getClaudeSettingsPath()): Promise<{ changed: boolean; path: string }> {
  const settings = await readSettings(settingsPath);
  if (!isRecord(settings.hooks)) return { changed: false, path: settingsPath };
  const hooks = settings.hooks;
  let changed = false;

  for (const spec of HOOK_SPECS) {
    const rawGroups = hooks[spec.event];
    if (!Array.isArray(rawGroups)) continue;
    const nextGroups: unknown[] = [];

    for (const group of rawGroups) {
      if (!isRecord(group)) {
        nextGroups.push(group);
        continue;
      }
      const handlers = group.hooks;
      if (!Array.isArray(handlers)) {
        nextGroups.push(group);
        continue;
      }
      const nextHandlers = handlers.filter((handler) => !isWaitloopHandler(handler));
      if (nextHandlers.length !== handlers.length) changed = true;
      if (nextHandlers.length > 0) nextGroups.push({ ...group, hooks: nextHandlers });
    }

    if (nextGroups.length > 0) hooks[spec.event] = nextGroups;
    else if (rawGroups.length > 0) delete hooks[spec.event];
  }

  if (Object.keys(hooks).length === 0) delete settings.hooks;
  if (changed) await writeSettings(settingsPath, settings);
  return { changed, path: settingsPath };
}
