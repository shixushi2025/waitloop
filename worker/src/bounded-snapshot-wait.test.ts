import { describe, expect, it, vi } from "vitest";

import { boundedSnapshotWait } from "./bounded-snapshot-wait";

describe("boundedSnapshotWait", () => {
  it("returns an immediately actionable snapshot without delaying", async () => {
    const readSnapshot = vi.fn(async () => ({
      ok: true as const,
      snapshot: { ready: true },
    }));
    const delay = vi.fn(async () => undefined);

    const result = await boundedSnapshotWait({
      timeoutMs: 1_000,
      pollMs: 100,
      readSnapshot,
      classify: (snapshot) => snapshot.ready ? "ready" as const : null,
      now: () => 10,
      delay,
    });

    expect(result).toEqual({
      kind: "matched",
      reason: "ready",
      waitedMs: 0,
      snapshot: { ready: true },
    });
    expect(readSnapshot).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it("polls one snapshot at a time until the classifier matches", async () => {
    let now = 0;
    let reads = 0;
    const delays: number[] = [];

    const result = await boundedSnapshotWait({
      timeoutMs: 1_000,
      pollMs: 200,
      readSnapshot: async () => ({
        ok: true as const,
        snapshot: { revision: ++reads },
      }),
      classify: (snapshot) => snapshot.revision >= 3 ? "changed" as const : null,
      now: () => now,
      delay: async (ms) => {
        delays.push(ms);
        now += ms;
      },
    });

    expect(result).toEqual({
      kind: "matched",
      reason: "changed",
      waitedMs: 400,
      snapshot: { revision: 3 },
    });
    expect(delays).toEqual([200, 200]);
  });

  it("clamps the final delay and returns the last authoritative snapshot on timeout", async () => {
    let now = 0;
    let reads = 0;
    const delays: number[] = [];

    const result = await boundedSnapshotWait({
      timeoutMs: 450,
      pollMs: 200,
      readSnapshot: async () => ({
        ok: true as const,
        snapshot: { sequence: ++reads },
      }),
      classify: () => null,
      now: () => now,
      delay: async (ms) => {
        delays.push(ms);
        now += ms;
      },
    });

    expect(result).toEqual({
      kind: "timeout",
      waitedMs: 450,
      snapshot: { sequence: 4 },
    });
    expect(delays).toEqual([200, 200, 50]);
  });

  it("returns a snapshot read error without retrying or delaying", async () => {
    const readSnapshot = vi.fn(async () => ({
      ok: false as const,
      error: { code: "room_expired", message: "Room expired." },
    }));
    const delay = vi.fn(async () => undefined);

    const result = await boundedSnapshotWait({
      timeoutMs: 1_000,
      pollMs: 100,
      readSnapshot,
      classify: () => null,
      delay,
    });

    expect(result).toEqual({
      kind: "read_error",
      error: { code: "room_expired", message: "Room expired." },
    });
    expect(readSnapshot).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it("honors an already-cancelled MCP wait before reading state", async () => {
    const controller = new AbortController();
    controller.abort();
    const readSnapshot = vi.fn(async () => ({
      ok: true as const,
      snapshot: { ready: false },
    }));

    await expect(boundedSnapshotWait({
      timeoutMs: 1_000,
      pollMs: 100,
      signal: controller.signal,
      readSnapshot,
      classify: () => null,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(readSnapshot).not.toHaveBeenCalled();
  });
});
