import { describe, expect, it } from "vitest";

import type { GameRoomSnapshotV1 } from "./game-room";
import { toHumanGameSnapshot } from "./human-game";

describe("human lobby projection", () => {
  it("does not expose dealt cards or landlord before the connected seat is ready", () => {
    const snapshot = {
      version: 1,
      roomId: "room-test",
      gameId: "doudizhu",
      status: "paused",
      revision: 0,
      currentPlayerId: null,
      legalMoves: [],
      state: {
        version: 1,
        role: "landlord",
        landlordId: "you",
        myHand: [{ id: "secret-card", rank: 17, suit: "joker" }],
        players: [
          { id: "you", role: "landlord", remaining: 20 },
          { id: "connected-agent", role: "farmer", remaining: 17 },
          { id: "bot", role: "farmer", remaining: 17 },
        ],
        currentPlayerId: "you",
        lastPlay: null,
        passesSinceLastPlay: 0,
        history: [],
      },
      participants: [],
      hostedAgentStats: [],
      roomPhase: "waiting_for_players",
      seatStates: [],
      turnStartedAt: 1,
    } as unknown as GameRoomSnapshotV1;

    const human = toHumanGameSnapshot(snapshot);
    const state = human.state as Record<string, unknown>;

    expect(state.landlordId).toBeNull();
    expect(state.role).toBe("pending");
    expect(state.myHand).toEqual([]);
    expect(JSON.stringify(human)).not.toContain("secret-card");
    expect(human.controls).toEqual({ version: 1, canPass: false, canHint: false });
  });
});
