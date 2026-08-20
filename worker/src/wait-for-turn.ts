export type WaitForTurnReasonV1 =
  | "your_turn"
  | "game_finished"
  | "room_paused"
  | "waiting_for_players"
  | "controller_changed";

export interface WaitForTurnSnapshotV1 {
  revision: number;
  status: string;
  roomPhase: string;
  currentPlayerId: string | null;
  viewerSeatId: string;
  capabilities: readonly string[];
}

export const DEFAULT_WAIT_FOR_TURN_TIMEOUT_MS = 25_000;
export const MAX_WAIT_FOR_TURN_TIMEOUT_MS = 25_000;
export const WAIT_FOR_TURN_POLL_MS = 750;

export function normalizeWaitForTurnTimeout(value: number | undefined): number {
  if (value === undefined) return DEFAULT_WAIT_FOR_TURN_TIMEOUT_MS;
  if (!Number.isSafeInteger(value) || value < 1_000) {
    throw new Error("timeoutMs must be an integer between 1000 and 25000.");
  }
  return Math.min(value, MAX_WAIT_FOR_TURN_TIMEOUT_MS);
}

export function classifyWaitForTurn(snapshot: WaitForTurnSnapshotV1): WaitForTurnReasonV1 | null {
  if (snapshot.roomPhase === "finished" || snapshot.status === "finished") return "game_finished";
  // A connected-Actor lobby pauses the underlying rules room while exposing a
  // distinct lifecycle phase. Preserve that more precise reason.
  if (snapshot.roomPhase === "waiting_for_players") return "waiting_for_players";
  if (snapshot.roomPhase === "paused" || snapshot.status === "paused") return "room_paused";
  if (!snapshot.capabilities.includes("seat:play")) return "controller_changed";
  if (snapshot.currentPlayerId === snapshot.viewerSeatId) return "your_turn";
  return null;
}

export function waitForTurnAbortReason(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  return new DOMException("MCP request cancelled", "AbortError");
}

export function throwIfWaitForTurnAborted(signal: AbortSignal): void {
  if (signal.aborted) throw waitForTurnAbortReason(signal);
}

export function waitForTurnDelay(ms: number, signal: AbortSignal): Promise<void> {
  throwIfWaitForTurnAborted(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(waitForTurnAbortReason(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}
