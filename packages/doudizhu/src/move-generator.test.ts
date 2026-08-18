import { describe, expect, it } from "vitest";

import {
  canBeat,
  classifyPattern,
  generateLegalPlays,
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

function pattern(...ranks: Rank[]): DoudizhuPattern {
  const result = classifyPattern(cards(...ranks));
  if (!result) throw new Error("test pattern must classify");
  return result;
}

describe("generateLegalPlays", () => {
  it("generates only classifiable unique plays", () => {
    const hand = cards(
      3, 3, 3,
      4, 4, 4,
      5, 5,
      6, 6,
      7,
      8,
      9,
      10,
      11,
      12,
      13,
      14,
      16,
      17,
    );

    const moves = generateLegalPlays(hand);
    const ids = new Set(moves.map((move) => move.id));

    expect(moves.length).toBeGreaterThan(20);
    expect(ids.size).toBe(moves.length);
    for (const move of moves) {
      expect(move.meta).toBeDefined();
      expect(classifyPattern(move.meta?.cards ?? [])).not.toBeNull();
    }
  });

  it("filters responses through pattern comparison", () => {
    const hand = cards(6, 6, 8, 8, 9, 9, 9, 9, 16, 17);
    const previous = pattern(7, 7);
    const moves = generateLegalPlays(hand, previous);

    expect(moves.some((move) => move.label === "8 8")).toBe(true);
    expect(moves.some((move) => move.label === "6 6")).toBe(false);
    expect(moves.some((move) => move.meta?.pattern.kind === "bomb")).toBe(true);
    expect(moves.some((move) => move.meta?.pattern.kind === "rocket")).toBe(true);

    for (const move of moves) {
      expect(move.meta && canBeat(move.meta.pattern, previous)).toBe(true);
    }
  });

  it("generates all contiguous straight lengths from a long run", () => {
    const moves = generateLegalPlays(cards(3, 4, 5, 6, 7, 8));
    const straights = moves.filter((move) => move.meta?.pattern.kind === "straight");

    expect(straights.some((move) => move.label === "3 4 5 6 7")).toBe(true);
    expect(straights.some((move) => move.label === "4 5 6 7 8")).toBe(true);
    expect(straights.some((move) => move.label === "3 4 5 6 7 8")).toBe(true);
  });

  it("generates airplane wings without consuming body ranks", () => {
    const moves = generateLegalPlays(cards(3, 3, 3, 4, 4, 4, 7, 8, 9, 9));

    expect(moves.some((move) => move.meta?.pattern.kind === "airplane")).toBe(true);
    expect(moves.some((move) => move.meta?.pattern.kind === "airplane-single")).toBe(true);
    expect(moves.some((move) => move.meta?.pattern.kind === "airplane-pair")).toBe(false);
  });

  it("generates four-with-two from a bomb without losing the bomb itself", () => {
    const moves = generateLegalPlays(cards(10, 10, 10, 10, 3, 3, 7, 7));

    expect(moves.some((move) => move.meta?.pattern.kind === "bomb")).toBe(true);
    expect(moves.some((move) => move.meta?.pattern.kind === "four-two-single")).toBe(true);
    expect(moves.some((move) => move.meta?.pattern.kind === "four-two-pair")).toBe(true);
  });
});
