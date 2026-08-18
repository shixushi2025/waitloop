import {
  BIG_JOKER_RANK,
  SMALL_JOKER_RANK,
  type Card,
  type Rank,
  type Suit,
} from "./card";

const SUITS: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
const STANDARD_RANKS: readonly Rank[] = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
];

const SUIT_IDS: Readonly<Record<Suit, string>> = {
  clubs: "C",
  diamonds: "D",
  hearts: "H",
  spades: "S",
};

export type RandomSource = () => number;

export interface DoudizhuDeal {
  hands: [Card[], Card[], Card[]];
  bottom: Card[];
}

export function createDeck(): Card[] {
  const deck: Card[] = [];

  for (const rank of STANDARD_RANKS) {
    for (const suit of SUITS) {
      deck.push({
        id: `${rank}${SUIT_IDS[suit]}`,
        rank,
        suit,
      });
    }
  }

  deck.push({ id: "SJ", rank: SMALL_JOKER_RANK });
  deck.push({ id: "BJ", rank: BIG_JOKER_RANK });

  return deck;
}

export function validateDeck(deck: readonly Card[]): void {
  if (deck.length !== 54) {
    throw new Error(`Dou Dizhu requires 54 cards, received ${deck.length}.`);
  }

  const ids = new Set<string>();
  for (const card of deck) {
    if (ids.has(card.id)) {
      throw new Error(`Duplicate card id: ${card.id}.`);
    }
    ids.add(card.id);
  }
}

export function shuffleDeck(
  deck: readonly Card[],
  random: RandomSource = Math.random,
): Card[] {
  const shuffled = [...deck];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const sample = random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
      throw new Error("Random source must return a number in [0, 1). ");
    }

    const target = Math.floor(sample * (index + 1));
    const current = shuffled[index];
    const other = shuffled[target];
    if (current === undefined || other === undefined) {
      throw new Error("Shuffle index invariant failed.");
    }

    shuffled[index] = other;
    shuffled[target] = current;
  }

  return shuffled;
}

export function dealDeck(deck: readonly Card[]): DoudizhuDeal {
  validateDeck(deck);

  return {
    hands: [deck.slice(0, 17), deck.slice(17, 34), deck.slice(34, 51)],
    bottom: deck.slice(51, 54),
  };
}
