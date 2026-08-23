import { describe, expect, it } from "vitest";

// Browser-only ESM is shipped without a build step; this test validates its runtime contract.
// @ts-expect-error JavaScript module intentionally has no TypeScript declaration in public assets.
import {
  nextRoomRefreshDelay,
  ROOM_REFRESH_MAX_DELAY_MS,
  ROOM_REFRESH_MIN_DELAY_MS,
  roomRefreshSignature,
  shouldRefreshRoom,
} from "../public/room-refresh-policy.js";

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    revision: 4,
    status: "playing",
    roomPhase: "playing",
    currentPlayerId: "seat-1",
    actors: [
      { id: "human", kind: "human" },
      { id: "agent", kind: "connected-agent" },
    ],
    actorStates: [
      { actorId: "human", status: "ready" },
      { actorId: "agent", status: "connected", lastSeenAt: 10 },
    ],
    seats: [
      { id: "seat-1", activeControllerActorId: "human" },
      { id: "seat-2", activeControllerActorId: "agent" },
    ],
    comments: [],
    ...overrides,
  };
}

describe("standalone Room refresh budget", () => {
  it("polls only visible connected/waiting rooms", () => {
    expect(shouldRefreshRoom(snapshot(), true)).toBe(true);
    expect(shouldRefreshRoom(snapshot(), false)).toBe(false);
    expect(shouldRefreshRoom(snapshot({ status: "finished", roomPhase: "finished" }), true)).toBe(false);
    expect(shouldRefreshRoom(snapshot({ roomPhase: "waiting_for_players", actors: [] }), true)).toBe(true);
    expect(shouldRefreshRoom(snapshot({ actors: [{ id: "human", kind: "human" }] }), true)).toBe(false);
  });

  it("backs unchanged rooms off to ten seconds and resets on change", () => {
    let delay = ROOM_REFRESH_MIN_DELAY_MS;
    delay = nextRoomRefreshDelay(delay, false);
    expect(delay).toBe(2000);
    delay = nextRoomRefreshDelay(delay, false);
    expect(delay).toBe(4000);
    delay = nextRoomRefreshDelay(delay, false);
    expect(delay).toBe(8000);
    delay = nextRoomRefreshDelay(delay, false);
    expect(delay).toBe(ROOM_REFRESH_MAX_DELAY_MS);
    expect(nextRoomRefreshDelay(delay, false)).toBe(ROOM_REFRESH_MAX_DELAY_MS);
    expect(nextRoomRefreshDelay(delay, true)).toBe(ROOM_REFRESH_MIN_DELAY_MS);
  });

  it("uses roomSeq as the authoritative semantic refresh signature when available", () => {
    expect(roomRefreshSignature(snapshot({ roomSeq: 9, revision: 4 }))).toBe("roomSeq:9");
    expect(roomRefreshSignature(snapshot({ roomSeq: 9, revision: 99 }))).toBe("roomSeq:9");
    expect(roomRefreshSignature(snapshot({ roomSeq: 10, revision: 4 }))).toBe("roomSeq:10");
  });

  it("falls back for legacy snapshots while ignoring heartbeat and array-order noise", () => {
    const base = snapshot();
    expect(roomRefreshSignature(snapshot({
      actorStates: [
        { actorId: "human", status: "ready" },
        { actorId: "agent", status: "connected", lastSeenAt: 999999 },
      ],
    }))).toBe(roomRefreshSignature(base));
    expect(roomRefreshSignature(snapshot({
      actors: [...base.actors].reverse(),
      seats: [...base.seats].reverse(),
    }))).toBe(roomRefreshSignature(base));
    expect(roomRefreshSignature(snapshot({ revision: 5 }))).not.toBe(roomRefreshSignature(base));
    expect(roomRefreshSignature(snapshot({
      actorStates: [
        { actorId: "human", status: "ready" },
        { actorId: "agent", status: "disconnected" },
      ],
    }))).not.toBe(roomRefreshSignature(base));
    expect(roomRefreshSignature(snapshot({
      comments: [{ id: "comment-1" }],
    }))).not.toBe(roomRefreshSignature(base));
  });
});
