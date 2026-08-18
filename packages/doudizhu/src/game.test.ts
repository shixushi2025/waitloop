import { describe, expect, it } from "vitest";

import { createDeck, doudizhuGame, type DoudizhuStateV1 } from "./index";

function createState(): DoudizhuStateV1 {
  return doudizhuGame.create({
    playerIds: ["p1", "p2", "p3"],
    landlordId: "p1",
    deck: createDeck(),
  });
}

describe("doudizhuGame", () => {
  it("deals 20 cards to the landlord and starts with the landlord", () => {
    const state = createState();

    expect(state.hands.p1).toHaveLength(20);
    expect(state.hands.p2).toHaveLength(17);
    expect(state.hands.p3).toHaveLength(17);
    expect(doudizhuGame.getCurrentPlayerId(state)).toBe("p1");
    expect(doudizhuGame.getStatus(state)).toBe("playing");
  });

  it("builds a viewer-specific public state without another hand", () => {
    const state = createState();
    const privateCard = state.hands.p2?.[0];
    if (!privateCard) throw new Error("test hand invariant failed");

    const view = doudizhuGame.getPublicState(state, "p1");

    expect(view.myHand).toHaveLength(20);
    expect(view.players.map((player) => player.remaining)).toEqual([20, 17, 17]);
    expect(JSON.stringify(view)).not.toContain(`\"id\":\"${privateCard.id}\"`);
  });

  it("resets the trick after two players pass", () => {
    let state = createState();
    const opening = doudizhuGame
      .getLegalMoves(state, "p1")
      .find((move) => move.meta?.type === "play");
    if (!opening) throw new Error("opening move invariant failed");

    state = doudizhuGame.applyMove(state, "p1", opening.id);
    expect(doudizhuGame.getLegalMoves(state, "p2").some((move) => move.id === "pass")).toBe(true);

    state = doudizhuGame.applyMove(state, "p2", "pass");
    expect(state.lastPlay).not.toBeNull();
    expect(state.passesSinceLastPlay).toBe(1);

    state = doudizhuGame.applyMove(state, "p3", "pass");
    expect(state.lastPlay).toBeNull();
    expect(state.passesSinceLastPlay).toBe(0);
    expect(doudizhuGame.getCurrentPlayerId(state)).toBe("p1");
  });

  it("can simulate a complete deterministic game using only generated move IDs", () => {
    let state = createState();

    for (let turn = 0; turn < 500 && doudizhuGame.getStatus(state) !== "finished"; turn += 1) {
      const playerId = doudizhuGame.getCurrentPlayerId(state);
      if (!playerId) throw new Error("active game must have a current player");

      const moves = doudizhuGame.getLegalMoves(state, playerId);
      const move = moves.find((candidate) => candidate.id !== "pass") ?? moves[0];
      if (!move) throw new Error("active player must have a legal move");

      state = doudizhuGame.applyMove(state, playerId, move.id);
    }

    expect(doudizhuGame.getStatus(state)).toBe("finished");
    expect(state.winnerId).toBeDefined();
    expect(state.winnerId && state.hands[state.winnerId]).toHaveLength(0);
  });
});
