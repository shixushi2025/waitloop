import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  classifyWaitForRoomUpdate,
  normalizeAfterRoomSeq,
  type WaitForRoomUpdateSnapshotV1,
} from "./wait-for-room-update";

function snapshot(overrides: Partial<WaitForRoomUpdateSnapshotV1> = {}): WaitForRoomUpdateSnapshotV1 {
  return { roomSeq: 7, status: "playing", roomPhase: "playing", ...overrides };
}

describe("wait_for_room_update cursor classification", () => {
  it("returns when a newer semantic Room event exists", () => {
    expect(classifyWaitForRoomUpdate(snapshot({ roomSeq: 8 }), 7)).toBe("room_updated");
  });

  it("keeps waiting while the semantic cursor is unchanged", () => {
    expect(classifyWaitForRoomUpdate(snapshot(), 7)).toBeNull();
  });

  it("returns a terminal Room even when the cursor is already current", () => {
    expect(classifyWaitForRoomUpdate(snapshot({ status: "finished", roomPhase: "finished" }), 7)).toBe("game_finished");
  });

  it("rejects a client cursor that is ahead of the authoritative Room", () => {
    expect(classifyWaitForRoomUpdate(snapshot(), 8)).toBe("cursor_ahead");
  });

  it("accepts zero for an initial full snapshot and rejects invalid cursors", () => {
    expect(normalizeAfterRoomSeq(0)).toBe(0);
    expect(classifyWaitForRoomUpdate(snapshot(), 0)).toBe("room_updated");
    expect(() => normalizeAfterRoomSeq(-1)).toThrow(/non-negative/);
    expect(() => normalizeAfterRoomSeq(1.5)).toThrow(/integer/);
  });

  it("rejects malformed Room snapshots", () => {
    expect(() => classifyWaitForRoomUpdate(snapshot({ roomSeq: 0 }), 0)).toThrow(/invalid roomSeq/);
  });

  it("is registered as a bounded remote MCP tool using the semantic cursor", () => {
    const source = readFileSync(new URL("./mcp.ts", import.meta.url), "utf8");
    expect(source).toContain('"wait_for_room_update"');
    expect(source).toContain("afterRoomSeq");
    expect(source).toContain("room_seq_ahead");
    expect(source).toContain("normalizeWaitForTurnTimeout");
    expect(source).toContain("WAIT_FOR_TURN_POLL_MS");
  });
});
