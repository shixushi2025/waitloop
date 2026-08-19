import { describe, expect, it } from "vitest";

import { createJoinCode, normalizeJoinCode, roomIdForJoinCode, selectRandomPlayer } from "./room-code";

describe("room join codes", () => {
  it("normalizes codes and rejects ambiguous characters", () => {
    expect(normalizeJoinCode(" wl-23456789ab ")).toBe("WL-23456789AB");
    expect(() => normalizeJoinCode("WL-OOOOOOOOOO")).toThrow();
  });

  it("creates deterministic code text from supplied entropy", () => {
    expect(createJoinCode(new Uint8Array(10))).toBe("WL-2222222222");
  });

  it("derives a stable opaque room id from a join code", async () => {
    const first = await roomIdForJoinCode("WL-23456789AB");
    const second = await roomIdForJoinCode("wl-23456789ab");
    expect(first).toBe(second);
    expect(first).toMatch(/^room-[0-9a-f]{32}$/);
    expect(first).not.toContain("23456789AB");
  });

  it("selects a landlord without privileging the human seat", () => {
    const players = ["you", "bot-a", "bot-b"] as const;
    expect(selectRandomPlayer(players, 0)).toBe("you");
    expect(selectRandomPlayer(players, 1)).toBe("bot-a");
    expect(selectRandomPlayer(players, 2)).toBe("bot-b");
  });
});
