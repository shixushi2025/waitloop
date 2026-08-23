import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(import.meta.dirname, "game-room.ts"), "utf8");

describe("GameRoom roomSeq integration contract", () => {
  it("centralizes state commits and exposes roomSeq in snapshots", () => {
    expect(source).toContain("private async commitState(");
    expect(source).toContain("next.roomSeq = nextRoomSeq(previous, next);");
    expect(source).toContain("roomSeq: normalizeRoomSeq(state.roomSeq)");
    expect(source).toContain("roomSeq: state.roomSeq");
    expect(source).toContain("roomSeq: 1");
    expect(source.match(/await this\.commitState\(/g)).toHaveLength(16);
    expect(source.match(/await this\.writeState\(/g)).toHaveLength(2);
    expect(source.match(/await this\.broadcast\(/g)).toHaveLength(1);
  });
});
