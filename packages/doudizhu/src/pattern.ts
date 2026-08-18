import {
  ACE_RANK,
  BIG_JOKER_RANK,
  SMALL_JOKER_RANK,
  groupCardsByRank,
  type Card,
  type Rank,
} from "./card";

export type DoudizhuPatternKind =
  | "single"
  | "pair"
  | "triple"
  | "triple-single"
  | "triple-pair"
  | "straight"
  | "pair-straight"
  | "airplane"
  | "airplane-single"
  | "airplane-pair"
  | "four-two-single"
  | "four-two-pair"
  | "bomb"
  | "rocket";

export interface DoudizhuPattern {
  kind: DoudizhuPatternKind;
  primaryRank: Rank;
  sequenceLength: number;
  cardCount: number;
}

interface RankCount {
  rank: Rank;
  count: number;
}

function rankCounts(cards: readonly Card[]): RankCount[] {
  return [...groupCardsByRank(cards).entries()]
    .map(([rank, group]) => ({ rank, count: group.length }))
    .sort((a, b) => a.rank - b.rank);
}

function isConsecutive(ranks: readonly Rank[]): boolean {
  if (ranks.length === 0) return false;

  for (let index = 1; index < ranks.length; index += 1) {
    const previous = ranks[index - 1];
    const current = ranks[index];
    if (previous === undefined || current === undefined || current !== previous + 1) {
      return false;
    }
  }

  return true;
}

function makePattern(
  kind: DoudizhuPatternKind,
  primaryRank: Rank,
  sequenceLength: number,
  cardCount: number,
): DoudizhuPattern {
  return { kind, primaryRank, sequenceLength, cardCount };
}

function classifyAirplaneWithWings(
  counts: readonly RankCount[],
  cardCount: number,
  wing: "single" | "pair",
): DoudizhuPattern | null {
  const divisor = wing === "single" ? 4 : 5;
  if (cardCount % divisor !== 0) return null;

  const sequenceLength = cardCount / divisor;
  if (sequenceLength < 2) return null;

  const candidates = counts
    .filter(({ rank, count }) => rank <= ACE_RANK && count === 3)
    .map(({ rank }) => rank);

  for (let start = 0; start <= candidates.length - sequenceLength; start += 1) {
    const body = candidates.slice(start, start + sequenceLength);
    if (body.length !== sequenceLength || !isConsecutive(body)) continue;

    const bodySet = new Set<Rank>(body);
    const wings = counts.filter(({ rank }) => !bodySet.has(rank));

    if (wing === "single") {
      const wingCards = wings.reduce((total, item) => total + item.count, 0);
      if (wingCards !== sequenceLength) continue;
    } else {
      if (wings.length !== sequenceLength || wings.some(({ count }) => count !== 2)) {
        continue;
      }
    }

    const primaryRank = body[body.length - 1];
    if (primaryRank !== undefined) {
      return makePattern(
        wing === "single" ? "airplane-single" : "airplane-pair",
        primaryRank,
        sequenceLength,
        cardCount,
      );
    }
  }

  return null;
}

export function classifyPattern(cards: readonly Card[]): DoudizhuPattern | null {
  const cardCount = cards.length;
  if (cardCount === 0) return null;

  const counts = rankCounts(cards);

  if (
    cardCount === 2 &&
    counts.length === 2 &&
    counts[0]?.rank === SMALL_JOKER_RANK &&
    counts[1]?.rank === BIG_JOKER_RANK
  ) {
    return makePattern("rocket", BIG_JOKER_RANK, 1, 2);
  }

  if (counts.length === 1) {
    const only = counts[0];
    if (only === undefined) return null;

    if (cardCount === 1) return makePattern("single", only.rank, 1, 1);
    if (cardCount === 2) return makePattern("pair", only.rank, 1, 2);
    if (cardCount === 3) return makePattern("triple", only.rank, 1, 3);
    if (cardCount === 4) return makePattern("bomb", only.rank, 1, 4);
    return null;
  }

  if (cardCount === 4) {
    const triple = counts.find(({ count }) => count === 3);
    if (triple) return makePattern("triple-single", triple.rank, 1, 4);
  }

  if (cardCount === 5) {
    const triple = counts.find(({ count }) => count === 3);
    const pair = counts.find(({ count }) => count === 2);
    if (triple && pair) return makePattern("triple-pair", triple.rank, 1, 5);
  }

  if (
    cardCount >= 5 &&
    counts.length === cardCount &&
    counts.every(({ rank, count }) => rank <= ACE_RANK && count === 1)
  ) {
    const ranks = counts.map(({ rank }) => rank);
    if (isConsecutive(ranks)) {
      const primaryRank = ranks[ranks.length - 1];
      if (primaryRank !== undefined) {
        return makePattern("straight", primaryRank, ranks.length, cardCount);
      }
    }
  }

  if (
    cardCount >= 6 &&
    cardCount % 2 === 0 &&
    counts.length === cardCount / 2 &&
    counts.every(({ rank, count }) => rank <= ACE_RANK && count === 2)
  ) {
    const ranks = counts.map(({ rank }) => rank);
    if (ranks.length >= 3 && isConsecutive(ranks)) {
      const primaryRank = ranks[ranks.length - 1];
      if (primaryRank !== undefined) {
        return makePattern("pair-straight", primaryRank, ranks.length, cardCount);
      }
    }
  }

  if (
    cardCount >= 6 &&
    cardCount % 3 === 0 &&
    counts.length === cardCount / 3 &&
    counts.every(({ rank, count }) => rank <= ACE_RANK && count === 3)
  ) {
    const ranks = counts.map(({ rank }) => rank);
    if (ranks.length >= 2 && isConsecutive(ranks)) {
      const primaryRank = ranks[ranks.length - 1];
      if (primaryRank !== undefined) {
        return makePattern("airplane", primaryRank, ranks.length, cardCount);
      }
    }
  }

  const airplaneSingle = classifyAirplaneWithWings(counts, cardCount, "single");
  if (airplaneSingle) return airplaneSingle;

  const airplanePair = classifyAirplaneWithWings(counts, cardCount, "pair");
  if (airplanePair) return airplanePair;

  if (cardCount === 6) {
    const four = counts.find(({ count }) => count === 4);
    if (four) {
      const attachments = counts.filter(({ rank }) => rank !== four.rank);
      const attachmentCount = attachments.reduce((total, item) => total + item.count, 0);
      if (attachmentCount === 2 && attachments.every(({ count }) => count <= 2)) {
        return makePattern("four-two-single", four.rank, 1, 6);
      }
    }
  }

  if (cardCount === 8) {
    const four = counts.find(({ count }) => count === 4);
    if (four) {
      const attachments = counts.filter(({ rank }) => rank !== four.rank);
      if (attachments.length === 2 && attachments.every(({ count }) => count === 2)) {
        return makePattern("four-two-pair", four.rank, 1, 8);
      }
    }
  }

  return null;
}
