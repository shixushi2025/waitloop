import { describe, expect, it } from "vitest";

import type { GameRoomSnapshotV1 } from "./game-room";
import { toHumanGameSnapshot } from "./human-game";

function baseSnapshot() {
  return {
    version: 1,
    roomId: "room-test",
    gameId: "doudizhu",
    status: "playing",
    revision: 3,
    currentPlayerId: "you",
    legalMoves: [
      { id: "pass", label: "pass" },
      { id: "play-1", label: "play one" },
    ],
    state: {
      version: 1,
      role: "landlord",
      landlordId: "you",
      myHand: [{ id: "secret-card", rank: 17, suit: "joker" }],
      players: [
        { id: "you", role: "landlord", remaining: 20 },
        { id: "bot-a", role: "farmer", remaining: 17 },
        { id: "bot-b", role: "farmer", remaining: 17 },
      ],
      currentPlayerId: "you",
      lastPlay: null,
      passesSinceLastPlay: 0,
      history: [],
    },
    participants: [],
    hostedAgentStats: [],
    roomPhase: "playing",
    seatStates: [],
    actors: [],
    seats: [],
    bindings: [],
    actorStates: [],
    comments: [],
    viewerActorId: "human",
    viewerSeatId: "you",
    capabilities: ["seat:play"],
    turnStartedAt: 1,
  } as unknown as GameRoomSnapshotV1;
}

describe("human game projection", () => {
  it("does not expose dealt cards or landlord before the connected actor is ready", () => {
    const snapshot = baseSnapshot();
    snapshot.status = "paused";
    snapshot.roomPhase = "waiting_for_players";
    snapshot.currentPlayerId = null;
    snapshot.capabilities = [];

    const human = toHumanGameSnapshot(snapshot);
    const state = human.state as Record<string, unknown>;

    expect(state.landlordId).toBeNull();
    expect(state.role).toBe("pending");
    expect(state.myHand).toEqual([]);
    expect(JSON.stringify(human)).not.toContain("secret-card");
    expect(human.controls).toEqual({ version: 1, canPlay: false, canPass: false, canHint: false });
  });

  it("keeps the private hand visible but disables input after control is delegated", () => {
    const snapshot = baseSnapshot();
    snapshot.capabilities = ["seat:view-private", "seat:control"];

    const human = toHumanGameSnapshot(snapshot);
    const state = human.state as Record<string, unknown>;

    expect(JSON.stringify(state.myHand)).toContain("secret-card");
    expect(human.controls).toEqual({ version: 1, canPlay: false, canPass: false, canHint: false });
  });
});
