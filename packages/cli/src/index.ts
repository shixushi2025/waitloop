#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { detectAgents } from "./agents.js";
import { installClaudeCode, uninstallClaudeCode } from "./claude-code.js";
import { createConfig, getConfigPath, loadConfig, redactConfig, saveConfig } from "./config.js";
import { readLatestClaudeState, runClaudeCodeHook } from "./hook.js";

const VERSION = "0.0.0";

function help(): void {
  console.log(`waitloop ${VERSION}

Tiny games while your coding agent runs.

Usage:
  waitloop init [--url URL] [--ingest-token TOKEN] [--access-token TOKEN] [--yes]
  waitloop doctor
  waitloop install claude-code
  waitloop uninstall claude-code
  waitloop status
  waitloop open [--print]
  waitloop config
  waitloop hook claude-code
  waitloop --version
`);
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function printAgents(): ReturnType<typeof detectAgents> {
  const detections = detectAgents();
  console.log("agents/");
  for (const detection of detections) {
    const state = detection.installed ? "✓" : "·";
    const integration = detection.integration === "available" ? "ready" : "planned";
    console.log(`  ${state} ${detection.label.padEnd(14)} ${integration}`);
  }
  return detections;
}

async function promptYesNo(question: string, defaultYes = true): Promise<boolean> {
  if (!input.isTTY || !output.isTTY) return false;
  const readline = createInterface({ input, output });
  try {
    const suffix = defaultYes ? " [Y/n] " : " [y/N] ";
    const answer = (await readline.question(`${question}${suffix}`)).trim().toLowerCase();
    if (!answer) return defaultYes;
    return answer === "y" || answer === "yes";
  } finally {
    readline.close();
  }
}

async function commandInit(args: string[]): Promise<void> {
  const previous = await loadConfig();
  const url = optionValue(args, "--url");
  const ingestToken = optionValue(args, "--ingest-token");
  const accessToken = optionValue(args, "--access-token");
  const configInput: Parameters<typeof createConfig>[0] = { previous };
  if (url !== undefined) configInput.url = url;
  if (ingestToken !== undefined) configInput.ingestToken = ingestToken;
  if (accessToken !== undefined) configInput.accessToken = accessToken;
  const config = createConfig(configInput);
  await saveConfig(config);

  console.log("waitloop init\n");
  console.log(`config    ${getConfigPath()}`);
  console.log(`server    ${config.url}`);
  console.log(`device    ${config.deviceId}`);
  console.log(`ingest    ${config.ingestToken ? "configured" : "not configured"}`);
  console.log("");

  const detections = printAgents();
  const claude = detections.find((item) => item.id === "claude-code");
  if (!claude?.installed) {
    console.log("\nClaude Code was not detected. Run `waitloop install claude-code` after installing it.");
    return;
  }

  const install = hasFlag(args, "--yes") || await promptYesNo("Install the Claude Code lifecycle integration?");
  if (!install) {
    console.log("\nSkipped integration install. Run `waitloop install claude-code` when ready.");
    return;
  }

  const result = await installClaudeCode();
  console.log(`\n${result.changed ? "✓ installed" : "✓ already installed"} Claude Code integration`);
  console.log(`  ${result.path}`);
}

async function checkHealth(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/api/v1/health`, { signal: controller.signal });
    return response.ok ? `reachable · HTTP ${response.status}` : `responded · HTTP ${response.status}`;
  } catch {
    return "unreachable";
  } finally {
    clearTimeout(timeout);
  }
}

async function commandDoctor(): Promise<void> {
  console.log("waitloop doctor\n");
  const config = await loadConfig();
  if (!config) {
    console.log(`config    missing · ${getConfigPath()}`);
    console.log("server    not checked");
  } else {
    console.log(`config    ok · ${getConfigPath()}`);
    console.log(`server    ${config.url} · ${await checkHealth(config.url)}`);
  }
  console.log("");
  printAgents();
}

async function commandInstall(target: string | undefined): Promise<void> {
  if (target !== "claude-code") throw new Error("Only `waitloop install claude-code` is available in this alpha.");
  const result = await installClaudeCode();
  console.log(`${result.changed ? "installed" : "already installed"} claude-code`);
  console.log(result.path);
}

async function commandUninstall(target: string | undefined): Promise<void> {
  if (target !== "claude-code") throw new Error("Only `waitloop uninstall claude-code` is available in this alpha.");
  const result = await uninstallClaudeCode();
  console.log(`${result.changed ? "removed" : "not installed"} claude-code`);
  console.log(result.path);
}

async function commandStatus(): Promise<void> {
  const latest = await readLatestClaudeState();
  if (!latest) {
    console.log("no recent Claude Code turn");
    return;
  }
  const elapsedMs = Math.max(0, latest.updatedAt - latest.startedAt);
  const elapsed = Math.floor(elapsedMs / 1000);
  console.log("agent      claude-code");
  console.log(`status     ${latest.state}`);
  console.log(`session    ${latest.waitloopSessionId}`);
  console.log(`elapsed    ${elapsed}s`);
}

function launchUrl(url: string): void {
  const child = process.platform === "darwin"
    ? spawn("open", [url], { detached: true, stdio: "ignore" })
    : process.platform === "win32"
      ? spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" })
      : spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
  child.unref();
}

async function commandOpen(args: string[]): Promise<void> {
  const config = await loadConfig();
  if (!config) throw new Error("Run `waitloop init` first.");
  const latest = await readLatestClaudeState();
  const url = new URL(config.url);
  if (latest) url.searchParams.set("session", latest.waitloopSessionId);
  const value = url.toString();
  if (hasFlag(args, "--print")) console.log(value);
  else {
    launchUrl(value);
    console.log(value);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  if (!command || command === "help" || command === "--help" || command === "-h") {
    help();
    return;
  }
  if (command === "--version" || command === "-v" || command === "version") {
    console.log(VERSION);
    return;
  }

  if (command === "init") return commandInit(args.slice(1));
  if (command === "doctor") return commandDoctor();
  if (command === "install") return commandInstall(args[1]);
  if (command === "uninstall") return commandUninstall(args[1]);
  if (command === "status") return commandStatus();
  if (command === "open") return commandOpen(args.slice(1));
  if (command === "config") {
    const config = await loadConfig();
    console.log(config ? JSON.stringify(redactConfig(config), null, 2) : "no config");
    return;
  }
  if (command === "hook" && args[1] === "claude-code") return runClaudeCodeHook();

  throw new Error(`Unknown command: ${args.join(" ")}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`waitloop: ${message}`);
  process.exitCode = 1;
});
