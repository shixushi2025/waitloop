import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

import { getCodexHooksPath, WAITLOOP_CODEX_HOOK_COMMAND } from "./codex.js";

const CODEX_HOOK_EVENTS = ["UserPromptSubmit", "PermissionRequest", "Stop", "SessionEnd"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWaitloopHandler(value: unknown): boolean {
  return isRecord(value) && value.type === "command" && value.command === WAITLOOP_CODEX_HOOK_COMMAND;
}

export interface CodexHookDiagnostic {
  path: string;
  exists: boolean;
  installedEvents: string[];
  missingEvents: string[];
}

export async function inspectCodexHooks(path = getCodexHooksPath()): Promise<CodexHookDiagnostic> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") {
      return { path, exists: false, installedEvents: [], missingEvents: [...CODEX_HOOK_EVENTS] };
    }
    return { path, exists: true, installedEvents: [], missingEvents: [...CODEX_HOOK_EVENTS] };
  }

  const hooks = isRecord(parsed) && isRecord(parsed.hooks) ? parsed.hooks : {};
  const installedEvents: string[] = [];
  const missingEvents: string[] = [];
  for (const event of CODEX_HOOK_EVENTS) {
    const groups = hooks[event];
    const installed = Array.isArray(groups) && groups.some((group) =>
      isRecord(group) && Array.isArray(group.hooks) && group.hooks.some(isWaitloopHandler));
    if (installed) installedEvents.push(event);
    else missingEvents.push(event);
  }
  return { path, exists: true, installedEvents, missingEvents };
}

interface ProcessResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function runCommand(command: string, args: string[], timeoutMs = 2_500): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const executable = process.platform === "win32" ? "cmd.exe" : command;
    const executableArgs = process.platform === "win32" ? ["/d", "/s", "/c", command, ...args] : args;
    let stdout = "";
    let stderr = "";
    let settled = false;
    let child;
    try {
      child = spawn(executable, executableArgs, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      resolve({ ok: false, stdout: "", stderr: "" });
      return;
    }

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok, stdout, stderr });
    };
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", () => finish(false));
    child.once("close", (code) => finish(code === 0));
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* best effort */ }
      finish(false);
    }, timeoutMs);
  });
}

export interface CodexRuntimeDiagnostic {
  detected: boolean;
  version?: string;
  hooksFeature: "available" | "unavailable" | "unknown";
}

export async function inspectCodexRuntime(): Promise<CodexRuntimeDiagnostic> {
  const versionResult = await runCommand("codex", ["--version"]);
  if (!versionResult.ok) return { detected: false, hooksFeature: "unknown" };
  const versionMatch = `${versionResult.stdout}\n${versionResult.stderr}`.match(/\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/);

  const featuresResult = await runCommand("codex", ["features", "list"]);
  let hooksFeature: CodexRuntimeDiagnostic["hooksFeature"] = "unknown";
  if (featuresResult.ok) {
    const hookLine = featuresResult.stdout.split(/\r?\n/).find((line) => /(^|\s)hooks(\s|$)/i.test(line));
    if (hookLine) hooksFeature = /\btrue\b/i.test(hookLine) ? "available" : "unavailable";
  }

  return {
    detected: true,
    ...(versionMatch?.[1] ? { version: versionMatch[1] } : {}),
    hooksFeature,
  };
}

export interface PublishedCliDiagnostic {
  version: string;
  installCommand: string;
}

export async function fetchPublishedCliDiagnostic(serverUrl: string): Promise<PublishedCliDiagnostic | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_500);
  try {
    const response = await fetch(`${serverUrl.replace(/\/$/, "")}/agent.json`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!isRecord(body) || !isRecord(body.cli)) return null;
    if (typeof body.cli.version !== "string" || typeof body.cli.installCommand !== "string") return null;
    return { version: body.cli.version, installCommand: body.cli.installCommand };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
