import { describe, expect, it } from "vitest";

import {
  classifyWaitForTurn,
  normalizeWaitForTurnTimeout,
  waitForTurnDelay,
  type WaitForTurnSnapshotV1,
} from "./wait-for-turn";

function snapshot(overrides: Partial<WaitForTurnSnapshotV1> = {}): WaitForTurnSnapshotV1 {
  return {
    revision: 7,
    status: "playing",
    roomPhase: "playing",
    currentPlayerId: "seat-2",
    viewerSeatId: "seat-1",
    capabilities: ["seat:play"],
    ...overrides,
  };
}

describe("wait_for_turn classification", () => {
  it("returns immediately when the bound seat owns the turn", () => {
    expect(classifyWaitForTurn(snapshot({ currentPlayerId: "seat-1" }))).toBe("your_turn");
  });

  it("keeps waiting while another seat owns the turn", () => {
    expect(classifyWaitForTurn(snapshot())).toBeNull();
  });

  it("surfaces controller changes before waiting for another turn", () => {
    expect(classifyWaitForTurn(snapshot({ capabilities: ["seat:view-private"] }))).toBe("controller_changed");
  });

  it("surfaces terminal, lobby, and paused room states", () => {
    expect(classifyWaitForTurn(snapshot({ roomPhase: "finished", status: "finished" }))).toBe("game_finished");
    expect(classifyWaitForTurn(snapshot({ roomPhase: "waiting_for_players", status: "paused" }))).toBe("waiting_for_players");
    expect(classifyWaitForTurn(snapshot({ roomPhase: "paused", status: "paused" }))).toBe("room_paused");
  });
});

describe("wait_for_turn timeout", () => {
  it("uses the bounded default and clamps oversized values", () => {
    expect(normalizeWaitForTurnTimeout(undefined)).toBe(25_000);
    expect(normalizeWaitForTurnTimeout(60_000)).toBe(25_000);
  });

  it("rejects tiny or non-integer transport waits", () => {
    expect(() => normalizeWaitForTurnTimeout(999)).toThrow(/1000/);
    expect(() => normalizeWaitForTurnTimeout(1_500.5)).toThrow(/integer/);
  });

  it("aborts the poll delay immediately when the MCP request is cancelled", async () => {
    const controller = new AbortController();
    const waiting = waitForTurnDelay(25_000, controller.signal);
    controller.abort(new DOMException("cancelled", "AbortError"));
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
  });
});
