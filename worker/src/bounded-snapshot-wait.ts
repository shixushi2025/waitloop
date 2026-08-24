import { throwIfWaitCancelled, waitForTurnDelay } from "./wait-for-turn";

export type SnapshotReadResult<TSnapshot, TError> =
  | { ok: true; snapshot: TSnapshot }
  | { ok: false; error: TError };

export type BoundedSnapshotWaitResult<TSnapshot, TReason, TError> =
  | {
      kind: "matched";
      reason: TReason;
      waitedMs: number;
      snapshot: TSnapshot;
    }
  | {
      kind: "timeout";
      waitedMs: number;
      snapshot: TSnapshot;
    }
  | {
      kind: "read_error";
      error: TError;
    };

export interface BoundedSnapshotWaitOptions<TSnapshot, TReason, TError> {
  timeoutMs: number;
  pollMs: number;
  signal?: AbortSignal;
  readSnapshot: () => Promise<SnapshotReadResult<TSnapshot, TError>>;
  classify: (snapshot: TSnapshot) => TReason | null;
  now?: () => number;
  delay?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

function positiveInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

/**
 * Re-read one authoritative snapshot until its classifier becomes actionable or
 * the bounded transport wait expires. This helper owns orchestration only: the
 * caller still owns authentication, projection, classification, and result
 * shaping.
 */
export async function boundedSnapshotWait<TSnapshot, TReason, TError>(
  options: BoundedSnapshotWaitOptions<TSnapshot, TReason, TError>,
): Promise<BoundedSnapshotWaitResult<TSnapshot, TReason, TError>> {
  const timeoutMs = positiveInteger("timeoutMs", options.timeoutMs);
  const pollMs = positiveInteger("pollMs", options.pollMs);
  const now = options.now ?? Date.now;
  const delay = options.delay ?? waitForTurnDelay;
  const startedAt = now();

  while (true) {
    throwIfWaitCancelled(options.signal);
    const read = await options.readSnapshot();
    if (!read.ok) return { kind: "read_error", error: read.error };

    const snapshot = read.snapshot;
    const reason = options.classify(snapshot);
    const waitedMs = Math.max(0, now() - startedAt);
    if (reason !== null) {
      return {
        kind: "matched",
        reason,
        waitedMs,
        snapshot,
      };
    }

    if (waitedMs >= timeoutMs) {
      return {
        kind: "timeout",
        waitedMs,
        snapshot,
      };
    }

    await delay(Math.min(pollMs, timeoutMs - waitedMs), options.signal);
  }
}
