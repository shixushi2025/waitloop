export interface RoomSequenceComparableV1 {
  roomSeq?: number;
  room: {
    revision: number;
    status: string;
  };
  roomPhase: string;
  turnStartedAt: number;
  roomOwnerActorId: string;
  seats: Array<{
    id: string;
    ownerActorId: string;
    activeControllerActorId: string;
  }>;
  actors: Array<{
    id: string;
    kind: string;
    temporary?: boolean;
  }>;
  bindings: Array<{
    actorId: string;
    seatId: string;
    relation: string;
  }>;
  actorStates: Record<string, {
    actorId: string;
    status: string;
    lastSeenAt?: number;
    connectedAt?: number;
    disconnectedAt?: number;
    statusChangedAt?: number;
  }>;
  comments: Array<{
    id: string;
    actorId: string;
    text: string;
    createdAt: number;
  }>;
  botPlayerIds: string[];
  temporaryBotSeatIds: string[];
  join?: {
    actorId?: string;
    seatId?: string;
    playerId?: string;
    claimedAt?: number;
  };
}

function compareFirst(left: readonly unknown[], right: readonly unknown[]): number {
  return String(left[0] ?? "").localeCompare(String(right[0] ?? ""));
}

export function normalizeRoomSeq(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 ? value : 1;
}

export function roomEventSignature(state: RoomSequenceComparableV1): string {
  const seats = state.seats
    .map((seat) => [seat.id, seat.ownerActorId, seat.activeControllerActorId] as const)
    .sort(compareFirst);
  const actors = state.actors
    .map((actor) => [actor.id, actor.kind, actor.temporary === true] as const)
    .sort(compareFirst);
  const bindings = state.bindings
    .map((binding) => [binding.actorId, binding.seatId, binding.relation] as const)
    .sort(compareFirst);
  const actorStates = Object.values(state.actorStates)
    .map((runtime) => [runtime.actorId, runtime.status] as const)
    .sort(compareFirst);
  const comments = state.comments.map((comment) => [comment.id, comment.actorId, comment.text, comment.createdAt]);
  const join = state.join
    ? [
        state.join.actorId ?? state.join.playerId ?? null,
        state.join.seatId ?? state.join.playerId ?? null,
        state.join.claimedAt ?? null,
      ]
    : null;

  return JSON.stringify({
    roomStatus: state.room.status,
    roomPhase: state.roomPhase,
    turnStartedAt: state.turnStartedAt,
    roomOwnerActorId: state.roomOwnerActorId,
    seats,
    actors,
    bindings,
    actorStates,
    comments,
    botPlayerIds: [...state.botPlayerIds].sort(),
    temporaryBotSeatIds: [...state.temporaryBotSeatIds].sort(),
    join,
  });
}

export function nextRoomSeq(
  previous: RoomSequenceComparableV1,
  next: RoomSequenceComparableV1,
): number {
  const current = normalizeRoomSeq(previous.roomSeq);
  if (previous.room.revision !== next.room.revision) return current + 1;
  return roomEventSignature(previous) === roomEventSignature(next) ? current : current + 1;
}
