#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { detectAgents } from "./agents.js";
import { installClaudeCode, uninstallClaudeCode } from "./claude-code.js";
import { createConfig, getConfigPath, loadConfig, redactConfig, saveConfig } from "./config.js";
import { installCodex, readLatestCodexState, runCodexHook, uninstallCodex } from "./codex.js";
import { installCursor, readLatestCursorState, runCursorHook, uninstallCursor } from "./cursor.js";
import { readLatestClaudeState, runClaudeCodeHook } from "./hook.js";
import { commandJoin } from "./join.js";
import type { LocalTurnState } from "./lifecycle.js";
import { pairDevice, unpairDevice } from "./pairing.js";
import { getCliVersion } from "./version.js";

const VERSION = getCliVersion();

type InstallTarget = "claude-code" | "cursor" | "codex";

function help(): void {
  console.log(`waitloop ${VERSION}

Tiny games while your coding agent runs.

Usage:
  waitloop init [--url URL] [--ingest-token TOKEN] [--access-token TOKEN] [--yes]
  waitloop pair [--no-open] [--bootstrap-token TOKEN]
  waitloop join WL-XXXXXXXXXX [--url URL] [--json]
  waitloop unpair
  waitloop doctor
  waitloop install <claude-code|cursor|codex|all>
  waitloop uninstall <claude-code|cursor|codex|all>
  waitloop status
  waitloop open [--print]
  waitloop config
  waitloop hook <claude-code|cursor|codex>
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

async function installTarget(target: InstallTarget): Promise<{ changed: boolean; path: string }> {
  if (target === "claude-code") return installClaudeCode();
  if (target === "cursor") return installCursor();
  return installCodex();
}

async function uninstallTarget(target: InstallTarget): Promise<{ changed: boolean; path: string }> {
  if (target === "claude-code") return uninstallClaudeCode();
  if (target === "cursor") return uninstallCursor();
  return uninstallCodex();
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
  console.log(`paired    ${config.deviceToken ? "yes" : "no"}`);
  console.log(`ingest    ${config.ingestToken ? "legacy token configured" : "no legacy token"}`);
  console.log("");

  const detections = printAgents();
  const available = detections.filter(
    (item): item is typeof item & { id: InstallTarget } =>
      item.installed && item.integration === "available" &&
      (item.id === "claude-code" || item.id === "cursor" || item.id === "codex"),
  );
  if (available.length === 0) {
    console.log("\nNo installable lifecycle adapter was detected. Run `waitloop doctor` after installing an agent.");
    return;
  }

  const install = hasFlag(args, "--yes") || await promptYesNo("Install detected Waitloop lifecycle integrations?");
  if (!install) {
    console.log("\nSkipped integration install. Run `waitloop install <agent>` when ready.");
    return;
  }

  for (const agent of available) {
    const result = await installTarget(agent.id);
    console.log(`\n${result.changed ? "✓ installed" : "✓ already installed"} ${agent.label}`);
    console.log(`  ${result.path}`);
    if (agent.id === "codex") console.log("  review/trust the new hook in Codex with /hooks");
  }
}

async function commandPair(args: string[]): Promise<void> {
  const bootstrapToken = optionValue(args, "--bootstrap-token");
  const noOpen = hasFlag(args, "--no-open");
  const pairInput: Parameters<typeof pairDevice>[0] = {
    onPairingCreated(pairing) {
      console.log("pairing request created");
      console.log(`code      ${pairing.code}`);
      console.log(`expires   ${new Date(pairing.expiresAt).toLocaleTimeString()}`);
      console.log(`url       ${pairing.pairingUrl}`);
      console.log("waiting for browser approval...\n");
      if (!noOpen) launchUrl(pairing.pairingUrl);
    },
  };
  if (bootstrapToken !== undefined) pairInput.bootstrapToken = bootstrapToken;
  const result = await pairDevice(pairInput);
  console.log("paired");
  console.log(`device    ${result.deviceId}`);
  console.log(`scopes    ${result.scopes.join(", ")}`);
  console.log("credential stored privately; raw token was not printed");
}

async function commandUnpair(): Promise<void> {
  const result = await unpairDevice();
  if (!result.paired) {
    console.log("not paired");
    return;
  }
  console.log(result.revoked ? "device credential revoked and removed" : "remote credential was already invalid; local credential removed");
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
    console.log("pairing   not initialized");
  } else {
    console.log(`config    ok · ${getConfigPath()}`);
    console.log(`server    ${config.url} · ${await checkHealth(config.url)}`);
    console.log(`pairing   ${config.deviceToken ? "device credential configured" : "not paired"}`);
  }
  console.log("");
  printAgents();
}

function parseInstallTargets(target: string | undefined): InstallTarget[] {
  if (target === "all") return ["claude-code", "cursor", "codex"];
  if (target === "claude-code" || target === "cursor" || target === "codex") return [target];
  throw new Error("Target must be `claude-code`, `cursor`, `codex`, or `all`.");
}

async function commandInstall(target: string | undefined): Promise<void> {
  for (const item of parseInstallTargets(target)) {
    const result = await installTarget(item);
    console.log(`${result.changed ? "installed" : "already installed"} ${item}`);
    console.log(result.path);
    if (item === "codex") console.log("review/trust the new hook in Codex with /hooks");
  }
}

async function commandUninstall(target: string | undefined): Promise<void> {
  for (const item of parseInstallTargets(target)) {
    const result = await uninstallTarget(item);
    console.log(`${result.changed ? "removed" : "not installed"} ${item}`);
    console.log(result.path);
  }
}

async function latestStates(): Promise<LocalTurnState[]> {
  const states = await Promise.all([readLatestClaudeState(), readLatestCursorState(), readLatestCodexState()]);
  return states.filter((state): state is LocalTurnState => state !== null).sort((a, b) => b.updatedAt - a.updatedAt);
}

async function commandStatus(): Promise<void> {
  const states = await latestStates();
  if (states.length === 0) {
    console.log("no recent coding-agent turn");
    return;
  }
  for (const [index, latest] of states.entries()) {
    if (index > 0) console.log("");
    const elapsedMs = Math.max(0, latest.updatedAt - latest.startedAt);
    const elapsed = Math.floor(elapsedMs / 1000);
    console.log(`agent      ${latest.agent}`);
    console.log(`status     ${latest.state}`);
    console.log(`session    ${latest.waitloopSessionId}`);
    console.log(`elapsed    ${elapsed}s`);
  }
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
  const states = await latestStates();
  const active = states.find((state) => state.state === "running" || state.state === "waiting") ?? states[0];
  const url = new URL(config.url);
  if (active) url.searchParams.set("session", active.waitloopSessionId);
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
  if (command === "pair") return commandPair(args.slice(1));
  if (command === "join") return commandJoin(args[1], args.slice(2));
  if (command === "unpair") return commandUnpair();
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
  if (command === "hook" && args[1] === "cursor") return runCursorHook();
  if (command === "hook" && args[1] === "codex") return runCodexHook();

  throw new Error(`Unknown command: ${args.join(" ")}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`waitloop: ${message}`);
  process.exitCode = 1;
});
