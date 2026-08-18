import { describe, expect, it } from "vitest";

import {
  canBeat,
  classifyPattern,
  createDeck,
  dealDeck,
  type Card,
  type DoudizhuPattern,
  type Rank,
} from "./index";

function cards(...ranks: Rank[]): Card[] {
  const occurrence = new Map<Rank, number>();

  return ranks.map((rank) => {
    const next = (occurrence.get(rank) ?? 0) + 1;
    occurrence.set(rank, next);
    return { id: `${rank}-${next}`, rank };
  });
}

function expectKind(ranks: Rank[], kind: DoudizhuPattern["kind"], primaryRank: Rank): void {
  expect(classifyPattern(cards(...ranks))).toMatchObject({ kind, primaryRank });
}

describe("deck", () => {
  it("creates and deals one canonical 54-card deck", () => {
    const deck = createDeck();
    const ids = new Set(deck.map((card) => card.id));
    const deal = dealDeck(deck);

    expect(deck).toHaveLength(54);
    expect(ids.size).toBe(54);
    expect(deal.hands.map((hand) => hand.length)).toEqual([17, 17, 17]);
    expect(deal.bottom).toHaveLength(3);
  });
});

describe("classifyPattern", () => {
  it("classifies atomic patterns", () => {
    expectKind([3], "single", 3);
    expectKind([7, 7], "pair", 7);
    expectKind([9, 9, 9], "triple", 9);
    expectKind([11, 11, 11, 11], "bomb", 11);
    expectKind([16, 17], "rocket", 17);
  });

  it("classifies triple attachments", () => {
    expectKind([6, 6, 6, 12], "triple-single", 6);
    expectKind([8, 8, 8, 13, 13], "triple-pair", 8);
  });

  it("classifies straights and excludes 2 from sequences", () => {
    expect(classifyPattern(cards(3, 4, 5, 6, 7))).toMatchObject({
      kind: "straight",
      primaryRank: 7,
      sequenceLength: 5,
    });
    expect(classifyPattern(cards(10, 11, 12, 13, 14, 15))).toBeNull();
  });

  it("classifies consecutive pairs", () => {
    expect(classifyPattern(cards(6, 6, 7, 7, 8, 8))).toMatchObject({
      kind: "pair-straight",
      primaryRank: 8,
      sequenceLength: 3,
    });
  });

  it("classifies airplanes with no wings, single wings, and pair wings", () => {
    expect(classifyPattern(cards(3, 3, 3, 4, 4, 4))).toMatchObject({
      kind: "airplane",
      primaryRank: 4,
      sequenceLength: 2,
    });

    expect(classifyPattern(cards(5, 5, 5, 6, 6, 6, 9, 13))).toMatchObject({
      kind: "airplane-single",
      primaryRank: 6,
      sequenceLength: 2,
    });

    expect(classifyPattern(cards(7, 7, 7, 8, 8, 8, 10, 10, 12, 12))).toMatchObject({
      kind: "airplane-pair",
      primaryRank: 8,
      sequenceLength: 2,
    });
  });

  it("classifies four-with-two variants", () => {
    expectKind([10, 10, 10, 10, 3, 3], "four-two-single", 10);
    expectKind([12, 12, 12, 12, 4, 4, 9, 9], "four-two-pair", 12);
  });

  it("rejects malformed combinations", () => {
    expect(classifyPattern(cards(3, 3, 4, 4))).toBeNull();
    expect(classifyPattern(cards(14, 14, 15, 15, 16, 16))).toBeNull();
    expect(classifyPattern(cards(3, 3, 3, 5, 5, 5))).toBeNull();
  });
});

describe("canBeat", () => {
  function pattern(ranks: Rank[]): DoudizhuPattern {
    const result = classifyPattern(cards(...ranks));
    if (!result) throw new Error("test pattern must classify");
    return result;
  }

  it("requires compatible shapes for ordinary plays", () => {
    expect(canBeat(pattern([8, 8]), pattern([7, 7]))).toBe(true);
    expect(canBeat(pattern([8, 8]), pattern([7]))).toBe(false);
    expect(canBeat(pattern([4, 5, 6, 7, 8]), pattern([3, 4, 5, 6, 7]))).toBe(true);
    expect(canBeat(pattern([4, 5, 6, 7, 8, 9]), pattern([3, 4, 5, 6, 7]))).toBe(false);
  });

  it("implements bomb and rocket precedence", () => {
    expect(canBeat(pattern([3, 3, 3, 3]), pattern([15, 15]))).toBe(true);
    expect(canBeat(pattern([9, 9, 9, 9]), pattern([8, 8, 8, 8]))).toBe(true);
    expect(canBeat(pattern([8, 8, 8, 8]), pattern([9, 9, 9, 9]))).toBe(false);
    expect(canBeat(pattern([16, 17]), pattern([15, 15, 15, 15]))).toBe(true);
    expect(canBeat(pattern([17]), pattern([16, 17]))).toBe(false);
  });
});
