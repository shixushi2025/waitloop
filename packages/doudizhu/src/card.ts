export type Suit = "clubs" | "diamonds" | "hearts" | "spades";

export type Rank =
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17;

export interface Card {
  id: string;
  rank: Rank;
  suit?: Suit;
}

export const SMALL_JOKER_RANK: Rank = 16;
export const BIG_JOKER_RANK: Rank = 17;
export const TWO_RANK: Rank = 15;
export const ACE_RANK: Rank = 14;

const RANK_LABELS: Readonly<Record<Rank, string>> = {
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "10",
  11: "J",
  12: "Q",
  13: "K",
  14: "A",
  15: "2",
  16: "SJ",
  17: "BJ",
};

export function rankLabel(rank: Rank): string {
  return RANK_LABELS[rank];
}

export function compareCards(a: Card, b: Card): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  return a.id.localeCompare(b.id);
}

export function sortCards(cards: readonly Card[]): Card[] {
  return [...cards].sort(compareCards);
}

export function groupCardsByRank(cards: readonly Card[]): Map<Rank, Card[]> {
  const groups = new Map<Rank, Card[]>();

  for (const card of sortCards(cards)) {
    const group = groups.get(card.rank);
    if (group) group.push(card);
    else groups.set(card.rank, [card]);
  }

  return groups;
}

export function cardIds(cards: readonly Card[]): string[] {
  return sortCards(cards).map((card) => card.id);
}

export function cardSelectionKey(cards: readonly Card[]): string {
  return cardIds(cards).join(",");
}
