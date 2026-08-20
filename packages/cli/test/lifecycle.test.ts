import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  finishTurn,
  readLatestAgentState,
  readTurnState,
  startTurn,
} from "../src/lifecycle.js";

const originalFetch = globalThis.fetch;
const originalStateDir = process.env.WAITLOOP_STATE_DIR;
const originalUrl = process.env.WAITLOOP_URL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalStateDir === undefined) delete process.env.WAITLOOP_STATE_DIR;
  else process.env.WAITLOOP_STATE_DIR = originalStateDir;
  if (originalUrl === undefined) delete process.env.WAITLOOP_URL;
  else process.env.WAITLOOP_URL = originalUrl;
  vi.restoreAllMocks();
});

function okResponse(): Response {
  return new Response(JSON.stringify({ version: 1, accepted: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("lifecycle terminal cleanup", () => {
  it("keeps the latest state terminal while removing the native session file", async () => {
    const root = await mkdtemp(join(tmpdir(), "waitloop-lifecycle-"));
    process.env.WAITLOOP_STATE_DIR = root;
    process.env.WAITLOOP_URL = "https://waitloop.run";
    const events: Array<{ state: string }> = [];

    globalThis.fetch = vi.fn(async (_input, init) => {
      events.push(JSON.parse(String(init?.body)) as { state: string });
      return okResponse();
    }) as typeof fetch;

    try {
      const started = await startTurn("codex", "native-session-1");
      expect(started.state).toBe("running");

      const finished = await finishTurn("codex", "native-session-1", "completed");
      expect(finished).toMatchObject({
        waitloopSessionId: started.waitloopSessionId,
        state: "completed",
      });
      await expect(readTurnState("codex", "native-session-1")).resolves.toBeNull();
      await expect(readLatestAgentState("codex")).resolves.toMatchObject({
        waitloopSessionId: started.waitloopSessionId,
        state: "completed",
      });
      expect(events.map((event) => event.state)).toEqual(["running", "completed"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("is idempotent when Stop and SessionEnd both try to finalize the same native session", async () => {
    const root = await mkdtemp(join(tmpdir(), "waitloop-lifecycle-"));
    process.env.WAITLOOP_STATE_DIR = root;
    process.env.WAITLOOP_URL = "https://waitloop.run";
    const events: Array<{ state: string }> = [];

    globalThis.fetch = vi.fn(async (_input, init) => {
      events.push(JSON.parse(String(init?.body)) as { state: string });
      return okResponse();
    }) as typeof fetch;

    try {
      await startTurn("claude-code", "native-session-2");
      await finishTurn("claude-code", "native-session-2", "completed");
      await expect(finishTurn("claude-code", "native-session-2", "completed")).resolves.toBeNull();
      expect(events.map((event) => event.state)).toEqual(["running", "completed"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
