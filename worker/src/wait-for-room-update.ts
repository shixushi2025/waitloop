export type WaitForRoomUpdateReasonV1 = "room_updated" | "game_finished";

export type WaitForRoomUpdateClassificationV1 =
  | WaitForRoomUpdateReasonV1
  | "cursor_ahead"
  | null;

export interface WaitForRoomUpdateSnapshotV1 {
  roomSeq: number;
  status: string;
  roomPhase: string;
}

export function normalizeAfterRoomSeq(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("afterRoomSeq must be a non-negative integer.");
  }
  return value;
}

export function classifyWaitForRoomUpdate(
  snapshot: WaitForRoomUpdateSnapshotV1,
  afterRoomSeq: number,
): WaitForRoomUpdateClassificationV1 {
  const cursor = normalizeAfterRoomSeq(afterRoomSeq);
  if (!Number.isSafeInteger(snapshot.roomSeq) || snapshot.roomSeq < 1) {
    throw new Error("Room snapshot has an invalid roomSeq.");
  }
  if (cursor > snapshot.roomSeq) return "cursor_ahead";
  if (snapshot.roomPhase === "finished" || snapshot.status === "finished") return "game_finished";
  if (snapshot.roomSeq > cursor) return "room_updated";
  return null;
}
