import { describe, expect, it } from "vitest";

import {
  GameRoomError,
  applyGameRoomMove,
  createGameRoom,
  getGameRoomSnapshot,
  pauseGameRoom,
  resumeGameRoom,
  type GameDefinition,
} from "./index";

interface CounterState {
  players: string[];
  currentIndex: number;
  count: number;
  target: number;
}

const counterGame: GameDefinition<
  CounterState,
  { count: number },
  { players: string[]; target: number },
  never
> = {
  id: "counter",

  create(input) {
    return {
      players: [...input.players],
      currentIndex: 0,
      count: 0,
      target: input.target,
    };
  },

  getStatus(state) {
    return state.count >= state.target ? "finished" : "playing";
  },

  getPlayerIds(state) {
    return state.players;
  },

  getCurrentPlayerId(state) {
    if (state.count >= state.target) return null;
    return state.players[state.currentIndex] ?? null;
  },

  getPublicState(state) {
    return { count: state.count };
  },

  getLegalMoves(state, playerId) {
    if (this.getCurrentPlayerId(state) !== playerId) return [];
    return [{ id: "take", label: "take one" }];
  },

  applyMove(state, playerId, moveId) {
    if (moveId !== "take" || this.getCurrentPlayerId(state) !== playerId) {
      throw new Error("invalid counter move");
    }

    const count = state.count + 1;
    return {
      ...state,
      count,
      currentIndex: count >= state.target ? state.currentIndex : (state.currentIndex + 1) % state.players.length,
    };
  },
};

function errorCode(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof GameRoomError ? error.code : "unexpected";
  }
}

describe("generic game room", () => {
  it("only exposes legal moves to the current player", () => {
    const room = createGameRoom(counterGame, "room-1", {
      players: ["a", "b"],
      target: 2,
    });

    const a = getGameRoomSnapshot(counterGame, room, "a");
    const b = getGameRoomSnapshot(counterGame, room, "b");

    expect(a.legalMoves).toEqual([{ id: "take", label: "take one" }]);
    expect(b.legalMoves).toEqual([]);
  });

  it("advances revision and rejects stale moves", () => {
    const room = createGameRoom(counterGame, "room-1", {
      players: ["a", "b"],
      target: 2,
    });

    const afterA = applyGameRoomMove(counterGame, room, {
      version: 1,
      roomId: "room-1",
      playerId: "a",
      expectedRevision: 1,
      moveId: "take",
    });

    expect(afterA.revision).toBe(2);
    expect(getGameRoomSnapshot(counterGame, afterA, "b").legalMoves).toHaveLength(1);

    expect(
      errorCode(() =>
        applyGameRoomMove(counterGame, afterA, {
          version: 1,
          roomId: "room-1",
          playerId: "b",
          expectedRevision: 1,
          moveId: "take",
        }),
      ),
    ).toBe("stale_revision");
  });

  it("finishes without knowing anything about the concrete game", () => {
    const room = createGameRoom(counterGame, "room-1", {
      players: ["a", "b"],
      target: 2,
    });

    const afterA = applyGameRoomMove(counterGame, room, {
      version: 1,
      roomId: "room-1",
      playerId: "a",
      expectedRevision: 1,
      moveId: "take",
    });
    const afterB = applyGameRoomMove(counterGame, afterA, {
      version: 1,
      roomId: "room-1",
      playerId: "b",
      expectedRevision: 2,
      moveId: "take",
    });

    expect(afterB.status).toBe("finished");
    expect(afterB.revision).toBe(3);
    expect(getGameRoomSnapshot(counterGame, afterB, "a").legalMoves).toEqual([]);
  });

  it("pauses and resumes without mutating game state", () => {
    const room = createGameRoom(counterGame, "room-1", {
      players: ["a", "b"],
      target: 3,
    });

    const paused = pauseGameRoom(room);
    expect(paused.status).toBe("paused");
    expect(paused.gameState).toBe(room.gameState);
    expect(getGameRoomSnapshot(counterGame, paused, "a").legalMoves).toEqual([]);

    const resumed = resumeGameRoom(counterGame, paused);
    expect(resumed.status).toBe("playing");
    expect(resumed.revision).toBe(3);
  });
});
