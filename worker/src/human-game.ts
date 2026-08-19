import type { LegalMove } from "@waitloop/game-core";

import type { GameRoomSnapshotV1 } from "./game-room";

export interface HumanGameControlsV1 {
  version: 1;
  canPass: boolean;
  canHint: boolean;
}

export type HumanGameSnapshotV1 = Omit<GameRoomSnapshotV1, "legalMoves"> & {
  controls: HumanGameControlsV1;
};

export interface HumanGameHintV1 {
  version: 1;
  revision: number;
  cardIds: string[];
  label: string;
  index: number;
  total: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cardIdsForMove(move: LegalMove<unknown>): string[] | null {
  if (!isRecord(move.meta) || move.meta.type !== "play" || !Array.isArray(move.meta.cards)) return null;

  const ids: string[] = [];
  for (const card of move.meta.cards) {
    if (!isRecord(card) || typeof card.id !== "string" || card.id.length === 0) return null;
    ids.push(card.id);
  }
  return ids;
}

function signature(ids: readonly string[]): string {
  return [...ids].sort().join("\u001f");
}

function patternPenalty(move: LegalMove<unknown>): number {
  if (!isRecord(move.meta) || !isRecord(move.meta.pattern)) return 0;
  if (move.meta.pattern.kind === "rocket") return 2;
  if (move.meta.pattern.kind === "bomb") return 1;
  return 0;
}

function playableMoves(snapshot: GameRoomSnapshotV1): Array<{ move: LegalMove<unknown>; cardIds: string[] }> {
  const result: Array<{ move: LegalMove<unknown>; cardIds: string[] }> = [];
  for (const move of snapshot.legalMoves) {
    const cardIds = cardIdsForMove(move as LegalMove<unknown>);
    if (cardIds) result.push({ move: move as LegalMove<unknown>, cardIds });
  }
  return result;
}

export function toHumanGameSnapshot(snapshot: GameRoomSnapshotV1): HumanGameSnapshotV1 {
  const { legalMoves, ...rest } = snapshot;
  return {
    ...rest,
    controls: {
      version: 1,
      canPass: legalMoves.some((move) => move.id === "pass"),
      canHint: legalMoves.some((move) => move.id !== "pass"),
    },
  };
}

export function resolveHumanCardSelection(
  snapshot: GameRoomSnapshotV1,
  cardIds: readonly string[],
): LegalMove<unknown> | null {
  if (cardIds.length === 0 || cardIds.length > 20 || new Set(cardIds).size !== cardIds.length) return null;
  if (cardIds.some((id) => typeof id !== "string" || id.length === 0 || id.length > 128)) return null;

  const selected = signature(cardIds);
  for (const candidate of playableMoves(snapshot)) {
    if (signature(candidate.cardIds) === selected) return candidate.move;
  }
  return null;
}

export function getHumanHint(snapshot: GameRoomSnapshotV1, cursor: number): HumanGameHintV1 | null {
  const moves = playableMoves(snapshot).sort((a, b) => {
    const penalty = patternPenalty(a.move) - patternPenalty(b.move);
    if (penalty !== 0) return penalty;
    if (a.cardIds.length !== b.cardIds.length) return a.cardIds.length - b.cardIds.length;
    return a.move.label.localeCompare(b.move.label);
  });
  if (moves.length === 0) return null;

  const normalizedCursor = Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
  const index = normalizedCursor % moves.length;
  const selected = moves[index];
  if (!selected) return null;

  return {
    version: 1,
    revision: snapshot.revision,
    cardIds: [...selected.cardIds],
    label: selected.move.label,
    index,
    total: moves.length,
  };
}
