import type { DoudizhuPattern } from "./pattern";

export function canBeat(
  candidate: DoudizhuPattern,
  previous: DoudizhuPattern,
): boolean {
  if (previous.kind === "rocket") return false;
  if (candidate.kind === "rocket") return true;

  if (candidate.kind === "bomb") {
    if (previous.kind !== "bomb") return true;
    return candidate.primaryRank > previous.primaryRank;
  }

  if (previous.kind === "bomb") return false;

  if (candidate.kind !== previous.kind) return false;
  if (candidate.cardCount !== previous.cardCount) return false;
  if (candidate.sequenceLength !== previous.sequenceLength) return false;

  return candidate.primaryRank > previous.primaryRank;
}
