import { describe, expect, it } from "vitest";

import {
  nextRoomRefreshDelay,
  ROOM_REFRESH_MAX_DELAY_MS,
  ROOM_REFRESH_MIN_DELAY_MS,
  roomRefreshSignature,
  shouldRefreshRoom,
} from "./room-refresh-policy.js";

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

  it("ignores heartbeat and array-order noise but notices user-visible state changes", () => {
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
