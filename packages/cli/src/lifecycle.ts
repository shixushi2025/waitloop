import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { DEFAULT_WAITLOOP_URL, loadConfig } from "./config.js";

export type LifecycleAgent = "claude-code" | "cursor" | "codex";
export type AgentState = "running" | "waiting" | "completed" | "failed";

export interface LocalTurnState {
  version: 1;
  agent: LifecycleAgent;
  waitloopSessionId: string;
  state: AgentState;
  startedAt: number;
  updatedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readHookInput(): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function stateRoot(): string {
  return process.env.WAITLOOP_STATE_DIR || join(homedir(), ".waitloop", "state");
}

function agentStateDirectory(agent: LifecycleAgent): string {
  return join(stateRoot(), agent);
}

function safeNativeSessionKey(nativeSessionId: string): string {
  return createHash("sha256").update(nativeSessionId).digest("hex").slice(0, 32);
}

function nativeStatePath(agent: LifecycleAgent, nativeSessionId: string): string {
  return join(agentStateDirectory(agent), `${safeNativeSessionKey(nativeSessionId)}.json`);
}

export function latestStatePath(agent: LifecycleAgent): string {
  return join(agentStateDirectory(agent), "latest.json");
}

function parseState(value: unknown): LocalTurnState | null {
  if (!isRecord(value) || value.version !== 1) return null;
  if (value.agent !== "claude-code" && value.agent !== "cursor" && value.agent !== "codex") return null;
  if (typeof value.waitloopSessionId !== "string" || value.waitloopSessionId.length === 0) return null;
  if (value.state !== "running" && value.state !== "waiting" && value.state !== "completed" && value.state !== "failed") {
    return null;
  }
  if (typeof value.startedAt !== "number" || typeof value.updatedAt !== "number") return null;
  return {
    version: 1,
    agent: value.agent,
    waitloopSessionId: value.waitloopSessionId,
    state: value.state,
    startedAt: value.startedAt,
    updatedAt: value.updatedAt,
  };
}

async function readStateFile(path: string): Promise<LocalTurnState | null> {
  try {
    return parseState(JSON.parse(await readFile(path, "utf8")) as unknown);
  } catch {
    return null;
  }
}

async function writeStateFile(path: string, state: LocalTurnState): Promise<void> {
  const directory = agentStateDirectory(state.agent);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

async function writeTurnState(agent: LifecycleAgent, nativeSessionId: string, state: LocalTurnState): Promise<void> {
  await writeStateFile(nativeStatePath(agent, nativeSessionId), state);
  await writeStateFile(latestStatePath(agent), state);
}

export async function removeTurnState(agent: LifecycleAgent, nativeSessionId: string): Promise<void> {
  try {
    await unlink(nativeStatePath(agent, nativeSessionId));
  } catch {
    // State may already have been removed by another terminal hook.
  }
}

export async function readTurnState(agent: LifecycleAgent, nativeSessionId: string): Promise<LocalTurnState | null> {
  return readStateFile(nativeStatePath(agent, nativeSessionId));
}

export async function readLatestAgentState(agent: LifecycleAgent): Promise<LocalTurnState | null> {
  return readStateFile(latestStatePath(agent));
}

async function runtimeConfig(): Promise<{ url: string; ingestToken?: string }> {
  const config = await loadConfig();
  const url = (process.env.WAITLOOP_URL || config?.url || DEFAULT_WAITLOOP_URL).replace(/\/$/, "");
  const token = process.env.WAITLOOP_INGEST_TOKEN || config?.ingestToken;
  const result: { url: string; ingestToken?: string } = { url };
  if (token) result.ingestToken = token;
  return result;
}

async function sendAgentEvent(agent: LifecycleAgent, waitloopSessionId: string, state: AgentState): Promise<boolean> {
  const runtime = await runtimeConfig();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (runtime.ingestToken) headers.authorization = `Bearer ${runtime.ingestToken}`;

  const configuredTimeout = Number(process.env.WAITLOOP_HOOK_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? Math.min(configuredTimeout, 10_000) : 1_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${runtime.url}/api/v1/agent-events`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        version: 1,
        eventId: randomUUID(),
        sessionId: waitloopSessionId,
        agent,
        state,
        occurredAt: Date.now(),
      }),
      signal: controller.signal,
    });
    if (!response.ok && process.env.WAITLOOP_DEBUG === "1") {
      console.error(`waitloop hook delivery failed with HTTP ${response.status}`);
    }
    return response.ok;
  } catch (error) {
    if (process.env.WAITLOOP_DEBUG === "1") console.error("waitloop hook delivery failed", error);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function sessionPrefix(agent: LifecycleAgent): string {
  if (agent === "claude-code") return "claude";
  return agent;
}

export async function startTurn(agent: LifecycleAgent, nativeSessionId: string): Promise<LocalTurnState> {
  const now = Date.now();
  const state: LocalTurnState = {
    version: 1,
    agent,
    waitloopSessionId: `${sessionPrefix(agent)}-${randomUUID()}`,
    state: "running",
    startedAt: now,
    updatedAt: now,
  };
  await writeTurnState(agent, nativeSessionId, state);
  await sendAgentEvent(agent, state.waitloopSessionId, "running");
  return state;
}

export async function transitionTurn(
  agent: LifecycleAgent,
  nativeSessionId: string,
  state: AgentState,
): Promise<LocalTurnState | null> {
  const current = await readTurnState(agent, nativeSessionId);
  if (!current) return null;
  const next: LocalTurnState = { ...current, state, updatedAt: Date.now() };
  await writeTurnState(agent, nativeSessionId, next);
  await sendAgentEvent(agent, next.waitloopSessionId, state);
  return next;
}
