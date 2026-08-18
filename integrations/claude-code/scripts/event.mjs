import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_WAITLOOP_URL = "http://127.0.0.1:8787";
const REQUEST_TIMEOUT_MS = 2_500;

async function readStdinJson() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) return null;

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

function safeSessionKey(sessionId) {
  return createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
}

function stateDirectory() {
  return process.env.WAITLOOP_STATE_DIR || join(tmpdir(), "waitloop", "claude-code");
}

function statePath(sessionId) {
  return join(stateDirectory(), `${safeSessionKey(sessionId)}.json`);
}

async function readTurnState(sessionId) {
  try {
    const raw = await readFile(statePath(sessionId), "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed?.waitloopSessionId !== "string") return null;
    return { waitloopSessionId: parsed.waitloopSessionId };
  } catch {
    return null;
  }
}

async function writeTurnState(sessionId, waitloopSessionId) {
  const directory = stateDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });

  const serialized = `${JSON.stringify({ waitloopSessionId })}\n`;
  await writeFile(statePath(sessionId), serialized, { encoding: "utf8", mode: 0o600 });
  await writeFile(join(directory, "latest.json"), serialized, { encoding: "utf8", mode: 0o600 });
}

async function removeTurnState(sessionId) {
  try {
    await unlink(statePath(sessionId));
  } catch {
    // State may already be gone after another terminal hook.
  }
}

async function sendEvent(waitloopSessionId, state) {
  const baseUrl = (process.env.WAITLOOP_URL || DEFAULT_WAITLOOP_URL).replace(/\/$/, "");
  const headers = {
    "content-type": "application/json",
    accept: "application/json",
  };

  const token = process.env.WAITLOOP_INGEST_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    await fetch(`${baseUrl}/api/v1/agent-events`, {
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
  } catch (error) {
    if (process.env.WAITLOOP_DEBUG === "1") {
      console.error("waitloop hook delivery failed", error);
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const input = await readStdinJson();
  const claudeSessionId = input?.session_id;
  const hook = input?.hook_event_name;

  if (typeof claudeSessionId !== "string" || typeof hook !== "string") return;

  if (hook === "UserPromptSubmit") {
    const waitloopSessionId = `claude-${randomUUID()}`;
    await writeTurnState(claudeSessionId, waitloopSessionId);
    await sendEvent(waitloopSessionId, "running");
    return;
  }

  if (hook === "SessionEnd") {
    await removeTurnState(claudeSessionId);
    return;
  }

  const turn = await readTurnState(claudeSessionId);
  if (!turn) return;

  if (hook === "PermissionRequest" || hook === "Notification") {
    await sendEvent(turn.waitloopSessionId, "waiting");
    return;
  }

  if (hook === "Stop") {
    await sendEvent(turn.waitloopSessionId, "completed");
    await removeTurnState(claudeSessionId);
    return;
  }

  if (hook === "StopFailure") {
    await sendEvent(turn.waitloopSessionId, "failed");
    await removeTurnState(claudeSessionId);
  }
}

await main();
