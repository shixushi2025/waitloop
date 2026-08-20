import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { claimJoinCredential, commandJoin, loadActiveJoinCredential } from "../src/join.js";

const originalFetch = globalThis.fetch;
const originalJoinDir = process.env.WAITLOOP_JOIN_DIR;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalJoinDir === undefined) delete process.env.WAITLOOP_JOIN_DIR;
  else process.env.WAITLOOP_JOIN_DIR = originalJoinDir;
  vi.restoreAllMocks();
});

describe("waitloop join cache", () => {
  it("ignores an expired room credential, refreshes it, and selects the fresh room", async () => {
    const root = await mkdtemp(join(tmpdir(), "waitloop-join-"));
    const code = "WL-23456789AB";
    process.env.WAITLOOP_JOIN_DIR = root;

    try {
      await writeFile(join(root, `${code}.json`), JSON.stringify({
        version: 1,
        code,
        roomId: "room-expired",
        serverUrl: "https://waitloop.run",
        joinUrl: `https://waitloop.run/join/${code}`,
        seatToken: "wlseat_expired",
        actorId: "connected-agent",
        seatId: "seat-1",
        relation: "controller",
        roomExpiresAt: Date.now() - 1_000,
        mcp: {
          type: "http",
          url: "https://waitloop.run/mcp",
          headers: {
            Authorization: "Bearer wlseat_expired",
            "X-Waitloop-Room": "room-expired",
          },
        },
      }));

      const roomExpiresAt = Date.now() + 60_000;
      const seatToken = "wlseat_fresh_credential_value";
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({
        version: 1,
        code,
        roomId: "room-fresh",
        joinUrl: `https://waitloop.run/join/${code}`,
        seatToken,
        actorId: "connected-agent",
        seatId: "seat-1",
        relation: "controller",
        expiresAt: Date.now() + 30_000,
        roomExpiresAt,
        mcp: {
          type: "http",
          url: "https://waitloop.run/mcp",
          headers: {
            Authorization: `Bearer ${seatToken}`,
            "X-Waitloop-Room": "room-fresh",
          },
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
      globalThis.fetch = fetchMock as typeof fetch;
      const logs: string[] = [];
      vi.spyOn(console, "log").mockImplementation((value?: unknown) => logs.push(String(value ?? "")));

      await commandJoin(code, ["--url", "https://waitloop.run", "--json"]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const cached = JSON.parse(await readFile(join(root, `${code}.json`), "utf8")) as {
        roomId: string;
        roomExpiresAt: number;
      };
      expect(cached.roomId).toBe("room-fresh");
      expect(cached.roomExpiresAt).toBe(roomExpiresAt);

      const pointer = JSON.parse(await readFile(join(root, "active.json"), "utf8")) as { code: string };
      expect(pointer.code).toBe(code);
      expect((await loadActiveJoinCredential())?.roomId).toBe("room-fresh");
      expect(logs.join("\n")).not.toContain(seatToken);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("passes cancellation into an uncached Join claim", async () => {
    const root = await mkdtemp(join(tmpdir(), "waitloop-join-abort-"));
    const code = "WL-23456789AB";
    process.env.WAITLOOP_JOIN_DIR = root;
    const controller = new AbortController();

    globalThis.fetch = vi.fn(async (_input, init) => {
      expect(init?.signal).toBe(controller.signal);
      return await new Promise<Response>((_resolve, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    }) as typeof fetch;

    try {
      const claim = claimJoinCredential(code, "https://waitloop.run", controller.signal);
      controller.abort();
      await expect(claim).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
