import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createHumanGame,
  getHumanGame,
  hintHumanTurn,
  passHumanTurn,
  playHumanCards,
} from "../src/human-room-client.js";

const originalFetch = globalThis.fetch;
const originalRoomDir = process.env.WAITLOOP_APP_ROOM_DIR;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalRoomDir === undefined) delete process.env.WAITLOOP_APP_ROOM_DIR;
  else process.env.WAITLOOP_APP_ROOM_DIR = originalRoomDir;
  vi.restoreAllMocks();
});

function snapshot(roomId: string, revision = 0) {
  return {
    version: 1,
    roomId,
    revision,
    status: "playing",
    roomPhase: "playing",
    viewerActorId: "actor-human",
    viewerSeatId: "seat-1",
    currentPlayerId: "seat-1",
    capabilities: ["seat:play"],
    controls: { version: 1, canPlay: true, canPass: false, canHint: true },
    state: {
      version: 1,
      role: "farmer",
      landlordId: "seat-2",
      myHand: [{ id: "c-3-clubs", rank: 3, suit: "clubs" }],
      players: [
        { id: "seat-1", role: "farmer", remaining: 17 },
        { id: "seat-2", role: "landlord", remaining: 20 },
        { id: "seat-3", role: "farmer", remaining: 17 },
      ],
      lastPlay: null,
      history: [],
    },
  };
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(value), { ...init, headers });
}

function createdResponse(roomId: string): Response {
  const headers = new Headers({ "content-type": "application/json" });
  headers.append("set-cookie", `wl_room_${roomId.replaceAll("-", "_")}=wlview_private_viewer_123; Path=/api/v1/rooms/${roomId}; HttpOnly; SameSite=Strict`);
  headers.append("set-cookie", "wl_actor=actor_0123456789abcdef0123456789abcdef.wla_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef; Path=/; HttpOnly; SameSite=Lax");
  return new Response(JSON.stringify({
    version: 1,
    roomId,
    mode: "bots",
    expiresAt: Date.now() + 60_000,
    snapshot: snapshot(roomId),
  }), { status: 201, headers });
}

describe("MCP App Human Room client", () => {
  it("creates a real Human table, persists credentials privately, and never returns them to the model", async () => {
    const root = await mkdtemp(join(tmpdir(), "waitloop-app-room-"));
    process.env.WAITLOOP_APP_ROOM_DIR = root;
    const roomId = "room-human-inline";
    const calls: Array<{ url: string; cookie: string | null }> = [];

    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({ url, cookie: headers.get("cookie") });
      if (url.endsWith("/api/v1/rooms") && init?.method === "POST") {
        expect(init.body).toBe(JSON.stringify({ version: 1, gameId: "doudizhu", mode: "bots" }));
        return createdResponse(roomId);
      }
      if (url.endsWith(`/api/v1/rooms/${roomId}`)) {
        expect(headers.get("cookie")).toContain("wl_actor=");
        expect(headers.get("cookie")).toContain("wl_room_");
        return jsonResponse({ version: 1, snapshot: snapshot(roomId, 1) });
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as typeof fetch;

    try {
      const created = await createHumanGame("https://waitloop.run");
      expect(created).toMatchObject({
        version: 1,
        kind: "waitloop.mcp-app.game",
        mode: "human-bots",
        roomId,
      });
      expect(created.fallback).toMatchObject({ sameRoom: false, inlineUiRequired: true });
      expect(JSON.stringify(created)).not.toContain("wlview_");
      expect(JSON.stringify(created)).not.toContain("wla_");

      const files = await readdir(root);
      expect(files).toHaveLength(1);
      expect(files[0]).not.toContain(roomId);
      const privateState = await readFile(join(root, files[0]!), "utf8");
      expect(privateState).toContain("wlview_");
      expect(privateState).toContain("wla_");

      const refreshed = await getHumanGame(roomId);
      expect(refreshed.snapshot.revision).toBe(1);
      expect(calls).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("proxies Human play, pass, and hint through the stored Room cookies", async () => {
    const root = await mkdtemp(join(tmpdir(), "waitloop-app-actions-"));
    process.env.WAITLOOP_APP_ROOM_DIR = root;
    const roomId = "room-human-actions";
    const actionBodies: Record<string, unknown>[] = [];

    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/v1/rooms") && init?.method === "POST") return createdResponse(roomId);
      const headers = new Headers(init?.headers);
      expect(headers.get("cookie")).toContain("wl_actor=");
      if (init?.body) actionBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      if (url.endsWith("/play")) return jsonResponse({ version: 1, snapshot: snapshot(roomId, 2) });
      if (url.endsWith("/pass")) return jsonResponse({ version: 1, snapshot: snapshot(roomId, 3) });
      if (url.endsWith("/hint")) {
        return jsonResponse({
          version: 1,
          hint: { version: 1, revision: 3, cardIds: ["c-3-clubs"], label: "single 3", index: 0, total: 2 },
        });
      }
      if (url.endsWith(`/api/v1/rooms/${roomId}`)) return jsonResponse({ version: 1, snapshot: snapshot(roomId, 3) });
      throw new Error(`Unexpected URL ${url}`);
    }) as typeof fetch;

    try {
      await createHumanGame("https://waitloop.run");
      await expect(playHumanCards(roomId, 1, ["c-3-clubs"])).resolves.toMatchObject({ roomId });
      await expect(passHumanTurn(roomId, 2)).resolves.toMatchObject({ roomId });
      await expect(hintHumanTurn(roomId, 3, 0)).resolves.toMatchObject({
        roomId,
        hint: { cardIds: ["c-3-clubs"], label: "single 3" },
      });
      expect(actionBodies).toEqual([
        { version: 1, expectedRevision: 1, cardIds: ["c-3-clubs"] },
        { version: 1, expectedRevision: 2 },
        { version: 1, expectedRevision: 3, cursor: 0 },
      ]);
      await expect(playHumanCards(roomId, 3, ["c-3-clubs", "c-3-clubs"])).rejects.toThrow(/duplicates/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
