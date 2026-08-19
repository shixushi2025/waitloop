import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { DEFAULT_WAITLOOP_URL, loadConfig } from "./config.js";

const REQUEST_TIMEOUT_MS = 2_500;

type AgentState = "running" | "waiting" | "completed" | "failed";

interface TurnState {
  version: 1;
  waitloopSessionId: string;
  state: AgentState;
  startedAt: number;
  updatedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readStdinJson(): Promise<Record<string, unknown> | null> {
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

function stateDirectory(): string {
  return process.env.WAITLOOP_STATE_DIR || join(homedir(), ".waitloop", "state", "claude-code");
}

function safeSessionKey(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
}

function statePath(sessionId: string): string {
  return join(stateDirectory(), `${safeSessionKey(sessionId)}.json`);
}

export function latestClaudeStatePath(): string {
  return join(stateDirectory(), "latest.json");
}

async function readTurnState(sessionId: string): Promise<TurnState | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(statePath(sessionId), "utf8"));
    if (!isRecord(parsed) || parsed.version !== 1) return null;
    if (
      typeof parsed.waitloopSessionId !== "string" ||
      (parsed.state !== "running" && parsed.state !== "waiting" && parsed.state !== "completed" && parsed.state !== "failed") ||
      typeof parsed.startedAt !== "number" ||
      typeof parsed.updatedAt !== "number"
    ) {
      return null;
    }
    return {
      version: 1,
      waitloopSessionId: parsed.waitloopSessionId,
      state: parsed.state,
      startedAt: parsed.startedAt,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}

async function writeStateFile(path: string, state: TurnState): Promise<void> {
  const directory = stateDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

async function writeTurnState(claudeSessionId: string, state: TurnState): Promise<void> {
  await writeStateFile(statePath(claudeSessionId), state);
  await writeStateFile(latestClaudeStatePath(), state);
}

async function removeTurnState(claudeSessionId: string): Promise<void> {
  try {
    await unlink(statePath(claudeSessionId));
  } catch {
    // The turn may already have been removed by another terminal hook.
  }
}

async function runtimeConfig(): Promise<{ url: string; ingestToken?: string }> {
  const config = await loadConfig();
  const url = (process.env.WAITLOOP_URL || config?.url || DEFAULT_WAITLOOP_URL).replace(/\/$/, "");
  const token = process.env.WAITLOOP_INGEST_TOKEN || config?.ingestToken;
  const result: { url: string; ingestToken?: string } = { url };
  if (token) result.ingestToken = token;
  return result;
}

async function sendEvent(waitloopSessionId: string, state: AgentState): Promise<boolean> {
  const runtime = await runtimeConfig();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (runtime.ingestToken) headers.authorization = `Bearer ${runtime.ingestToken}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${runtime.url}/api/v1/agent-events`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        version: 1,
        eventId: randomUUID(),
        sessionId: waitloopSessionId,
        agent: "claude-code",
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

async function transition(claudeSessionId: string, turn: TurnState, state: AgentState): Promise<void> {
  const next: TurnState = { ...turn, state, updatedAt: Date.now() };
  await writeTurnState(claudeSessionId, next);
  await sendEvent(next.waitloopSessionId, state);
}

export async function runClaudeCodeHook(): Promise<void> {
  const input = await readStdinJson();
  const claudeSessionId = input?.session_id;
  const hook = input?.hook_event_name;
  if (typeof claudeSessionId !== "string" || typeof hook !== "string") return;

  if (hook === "UserPromptSubmit") {
    const now = Date.now();
    const turn: TurnState = {
      version: 1,
      waitloopSessionId: `claude-${randomUUID()}`,
      state: "running",
      startedAt: now,
      updatedAt: now,
    };
    await writeTurnState(claudeSessionId, turn);
    await sendEvent(turn.waitloopSessionId, "running");
    return;
  }

  if (hook === "SessionEnd") {
    await removeTurnState(claudeSessionId);
    return;
  }

  const turn = await readTurnState(claudeSessionId);
  if (!turn) return;

  if (hook === "PermissionRequest" || hook === "Notification") {
    await transition(claudeSessionId, turn, "waiting");
    return;
  }
  if (hook === "Stop") {
    await transition(claudeSessionId, turn, "completed");
    await removeTurnState(claudeSessionId);
    return;
  }
  if (hook === "StopFailure") {
    await transition(claudeSessionId, turn, "failed");
    await removeTurnState(claudeSessionId);
  }
}

export async function readLatestClaudeState(): Promise<TurnState | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(latestClaudeStatePath(), "utf8"));
    if (!isRecord(parsed) || parsed.version !== 1 || typeof parsed.waitloopSessionId !== "string") return null;
    if (
      parsed.state !== "running" &&
      parsed.state !== "waiting" &&
      parsed.state !== "completed" &&
      parsed.state !== "failed"
    ) {
      return null;
    }
    if (typeof parsed.startedAt !== "number" || typeof parsed.updatedAt !== "number") return null;
    return {
      version: 1,
      waitloopSessionId: parsed.waitloopSessionId,
      state: parsed.state,
      startedAt: parsed.startedAt,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}
