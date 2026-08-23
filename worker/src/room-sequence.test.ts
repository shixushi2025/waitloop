import { describe, expect, it } from "vitest";

import {
  nextRoomSeq,
  normalizeRoomSeq,
  roomEventSignature,
  type RoomSequenceComparableV1,
} from "./room-sequence";

function state(overrides: Partial<RoomSequenceComparableV1> = {}): RoomSequenceComparableV1 {
  return {
    roomSeq: 7,
    room: { revision: 4, status: "playing" },
    roomPhase: "playing",
    turnStartedAt: 100,
    roomOwnerActorId: "human",
    seats: [
      { id: "seat-1", ownerActorId: "human", activeControllerActorId: "human" },
      { id: "seat-2", ownerActorId: "agent", activeControllerActorId: "agent" },
    ],
    actors: [
      { id: "human", kind: "human" },
      { id: "agent", kind: "connected-agent" },
    ],
    bindings: [
      { actorId: "human", seatId: "seat-1", relation: "controller" },
      { actorId: "agent", seatId: "seat-2", relation: "controller" },
    ],
    actorStates: {
      human: { actorId: "human", status: "ready", statusChangedAt: 1 },
      agent: { actorId: "agent", status: "connected", statusChangedAt: 2, lastSeenAt: 3 },
    },
    comments: [],
    botPlayerIds: [],
    temporaryBotSeatIds: [],
    ...overrides,
  };
}

describe("Room semantic event sequence", () => {
  it("normalizes legacy or invalid persisted sequence values", () => {
    expect(normalizeRoomSeq(undefined)).toBe(1);
    expect(normalizeRoomSeq(0)).toBe(1);
    expect(normalizeRoomSeq(7)).toBe(7);
  });

  it("advances when game revision changes", () => {
    const previous = state();
    const next = state({ room: { revision: 5, status: "playing" } });
    expect(nextRoomSeq(previous, next)).toBe(8);
  });

  it("advances for comments even when game revision is unchanged", () => {
    const previous = state();
    const next = state({
      comments: [{ id: "comment-1", actorId: "agent", text: "pass", createdAt: 10 }],
    });
    expect(nextRoomSeq(previous, next)).toBe(8);
    expect(next.room.revision).toBe(previous.room.revision);
  });

  it("advances for Controller changes without changing game revision", () => {
    const previous = state();
    const next = state({
      seats: [
        { id: "seat-1", ownerActorId: "human", activeControllerActorId: "agent" },
        { id: "seat-2", ownerActorId: "agent", activeControllerActorId: "agent" },
      ],
    });
    expect(nextRoomSeq(previous, next)).toBe(8);
  });

  it("advances for semantic presence transitions", () => {
    const previous = state();
    const next = state({
      actorStates: {
        ...previous.actorStates,
        agent: { actorId: "agent", status: "disconnected", statusChangedAt: 20, lastSeenAt: 21 },
      },
    });
    expect(nextRoomSeq(previous, next)).toBe(8);
  });

  it("does not advance for heartbeat-only timestamp refreshes", () => {
    const previous = state();
    const next = state({
      actorStates: {
        ...previous.actorStates,
        agent: {
          actorId: "agent",
          status: "connected",
          statusChangedAt: 999,
          connectedAt: 998,
          lastSeenAt: 1_000_000,
        },
      },
    });
    expect(nextRoomSeq(previous, next)).toBe(7);
  });

  it("is stable when collection order changes", () => {
    const previous = state();
    const next = state({
      seats: [...previous.seats].reverse(),
      actors: [...previous.actors].reverse(),
      bindings: [...previous.bindings].reverse(),
      actorStates: Object.fromEntries(Object.entries(previous.actorStates).reverse()),
    });
    expect(roomEventSignature(next)).toBe(roomEventSignature(previous));
    expect(nextRoomSeq(previous, next)).toBe(7);
  });
});
