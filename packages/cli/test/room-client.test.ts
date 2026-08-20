import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createAndActivateHeadlessRoom, getActiveRoom } from "../src/room-client.js";

const originalFetch = globalThis.fetch;
const originalJoinDir = process.env.WAITLOOP_JOIN_DIR;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalJoinDir === undefined) delete process.env.WAITLOOP_JOIN_DIR;
  else process.env.WAITLOOP_JOIN_DIR = originalJoinDir;
  vi.restoreAllMocks();
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("local room client", () => {
  it("creates, claims, connects, and activates a headless room without returning its credential", async () => {
    const root = await mkdtemp(join(tmpdir(), "waitloop-room-client-"));
    process.env.WAITLOOP_JOIN_DIR = root;
    const code = "WL-23456789AB";
    const roomId = "room-local-bridge";
    const seatToken = "wlseat_private_room_credential_1234567890";
    const calls: string[] = [];

    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/api/v1/rooms")) {
        expect(init?.body).toBe(JSON.stringify({ version: 1, gameId: "doudizhu", mode: "agent-bots" }));
        return jsonResponse({ version: 1, roomId, joinCode: code, headless: true }, 201);
      }
      if (url.endsWith(`/api/v1/join/${code}/claim`)) {
        return jsonResponse({
          version: 1,
          code,
          roomId,
          joinUrl: `https://waitloop.run/join/${code}`,
          seatToken,
          actorId: "actor-agent",
          seatId: "seat-1",
          relation: "controller",
          expiresAt: Date.now() + 30_000,
          roomExpiresAt: Date.now() + 60_000,
          mcp: {
            type: "http",
            url: "https://waitloop.run/mcp",
            headers: {
              Authorization: `Bearer ${seatToken}`,
              "X-Waitloop-Room": roomId,
            },
          },
        });
      }
      if (url.endsWith("/mcp")) {
        const headers = new Headers(init?.headers);
        expect(headers.get("authorization")).toBe(`Bearer ${seatToken}`);
        return jsonResponse({
          jsonrpc: "2.0",
          id: "test",
          result: {
            content: [{ type: "text", text: JSON.stringify({ revision: 3, viewerSeatId: "seat-1", currentPlayerId: "seat-1" }) }],
          },
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as typeof fetch;

    try {
      const created = await createAndActivateHeadlessRoom("https://waitloop.run");
      expect(created).toMatchObject({
        roomId,
        actorId: "actor-agent",
        seatId: "seat-1",
        relation: "controller",
        active: true,
        connected: true,
      });
      expect(JSON.stringify(created)).not.toContain(seatToken);
      expect(calls).toHaveLength(3);

      const pointer = JSON.parse(await readFile(join(root, "active.json"), "utf8")) as { code: string };
      expect(pointer.code).toBe(code);

      const active = await getActiveRoom();
      expect(active).toMatchObject({ roomId, connected: true });
      expect(calls).toHaveLength(4);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
