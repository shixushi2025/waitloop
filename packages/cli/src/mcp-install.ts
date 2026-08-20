import { spawnSync } from "node:child_process";

export type LocalMcpTarget = "codex" | "claude-code";

export interface CommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (command: string, args: string[]) => CommandResult;

function defaultRunner(command: string, args: string[]): CommandResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function targetCommand(target: LocalMcpTarget): string {
  return target === "codex" ? "codex" : "claude";
}

function getArgs(target: LocalMcpTarget): string[] {
  return target === "codex"
    ? ["mcp", "get", "waitloop"]
    : ["mcp", "get", "waitloop"];
}

function addArgs(target: LocalMcpTarget): string[] {
  return target === "codex"
    ? ["mcp", "add", "waitloop", "--", "waitloop", "mcp"]
    : ["mcp", "add", "--scope", "user", "waitloop", "--", "waitloop", "mcp"];
}

function removeArgs(target: LocalMcpTarget): string[] {
  return target === "codex"
    ? ["mcp", "remove", "waitloop"]
    : ["mcp", "remove", "--scope", "user", "waitloop"];
}

export function inspectLocalMcp(target: LocalMcpTarget, runner: CommandRunner = defaultRunner) {
  const command = targetCommand(target);
  const result = runner(command, getArgs(target));
  return {
    target,
    configured: result.status === 0,
    command: "waitloop mcp",
    detail: (result.stdout || result.stderr).trim(),
  };
}

export function installLocalMcp(target: LocalMcpTarget, runner: CommandRunner = defaultRunner) {
  const current = inspectLocalMcp(target, runner);
  if (current.configured) return { ...current, changed: false };

  const command = targetCommand(target);
  const result = runner(command, addArgs(target));
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new Error(`Could not configure Waitloop MCP for ${target}${detail ? `: ${detail}` : "."}`);
  }
  return {
    target,
    configured: true,
    changed: true,
    command: "waitloop mcp",
    detail: (result.stdout || result.stderr).trim(),
  };
}

export function uninstallLocalMcp(target: LocalMcpTarget, runner: CommandRunner = defaultRunner) {
  const current = inspectLocalMcp(target, runner);
  if (!current.configured) return { ...current, changed: false };

  const command = targetCommand(target);
  const result = runner(command, removeArgs(target));
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new Error(`Could not remove Waitloop MCP from ${target}${detail ? `: ${detail}` : "."}`);
  }
  return {
    target,
    configured: false,
    changed: true,
    command: "waitloop mcp",
    detail: (result.stdout || result.stderr).trim(),
  };
}
