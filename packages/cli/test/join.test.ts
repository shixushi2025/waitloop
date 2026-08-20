import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { commandJoin } from "../src/join.js";

const originalFetch = globalThis.fetch;
const originalJoinDir = process.env.WAITLOOP_JOIN_DIR;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalJoinDir === undefined) delete process.env.WAITLOOP_JOIN_DIR;
  else process.env.WAITLOOP_JOIN_DIR = originalJoinDir;
  vi.restoreAllMocks();
});

describe("waitloop join cache", () => {
  it("ignores an expired room credential and refreshes the cache", async () => {
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
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({
        version: 1,
        code,
        roomId: "room-fresh",
        joinUrl: `https://waitloop.run/join/${code}`,
        seatToken: "wlseat_fresh_credential_value",
        actorId: "connected-agent",
        seatId: "seat-1",
        relation: "controller",
        expiresAt: Date.now() + 30_000,
        roomExpiresAt,
        mcp: {
          type: "http",
          url: "https://waitloop.run/mcp",
          headers: {
            Authorization: "Bearer wlseat_fresh_credential_value",
            "X-Waitloop-Room": "room-fresh",
          },
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
      globalThis.fetch = fetchMock as typeof fetch;
      vi.spyOn(console, "log").mockImplementation(() => undefined);

      await commandJoin(code, ["--url", "https://waitloop.run", "--json"]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const cached = JSON.parse(await readFile(join(root, `${code}.json`), "utf8")) as {
        roomId: string;
        roomExpiresAt: number;
      };
      expect(cached.roomId).toBe("room-fresh");
      expect(cached.roomExpiresAt).toBe(roomExpiresAt);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
