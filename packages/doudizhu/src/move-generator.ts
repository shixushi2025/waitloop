import { type LegalMove } from "@waitloop/game-core";

import {
  ACE_RANK,
  cardSelectionKey,
  groupCardsByRank,
  rankLabel,
  sortCards,
  type Card,
  type Rank,
} from "./card";
import { canBeat } from "./compare";
import { classifyPattern, type DoudizhuPattern } from "./pattern";

export interface DoudizhuMoveMeta {
  type: "play";
  cards: Card[];
  pattern: DoudizhuPattern;
}

export type DoudizhuLegalPlay = LegalMove<DoudizhuMoveMeta>;

interface RankGroup {
  rank: Rank;
  cards: Card[];
}

function groupsFor(cards: readonly Card[]): RankGroup[] {
  return [...groupCardsByRank(cards).entries()].map(([rank, grouped]) => ({
    rank,
    cards: grouped,
  }));
}

function chooseRanks<T>(items: readonly T[], count: number): T[][] {
  if (count === 0) return [[]];
  if (items.length < count) return [];

  const result: T[][] = [];

  function visit(start: number, selected: T[]): void {
    if (selected.length === count) {
      result.push([...selected]);
      return;
    }

    const remainingNeeded = count - selected.length;
    for (let index = start; index <= items.length - remainingNeeded; index += 1) {
      const item = items[index];
      if (item === undefined) continue;
      selected.push(item);
      visit(index + 1, selected);
      selected.pop();
    }
  }

  visit(0, []);
  return result;
}

function chooseIndividualCardsByRank(
  groups: readonly RankGroup[],
  count: number,
): Card[][] {
  const result: Card[][] = [];

  function visit(index: number, remaining: number, selected: Card[]): void {
    if (remaining === 0) {
      result.push([...selected]);
      return;
    }

    if (index >= groups.length) return;

    const group = groups[index];
    if (group === undefined) return;

    const maxTake = Math.min(group.cards.length, remaining);
    for (let take = 0; take <= maxTake; take += 1) {
      const chosen = group.cards.slice(0, take);
      selected.push(...chosen);
      visit(index + 1, remaining - take, selected);
      selected.splice(selected.length - chosen.length, chosen.length);
    }
  }

  visit(0, count, []);
  return result;
}

function consecutiveSlices(
  groups: readonly RankGroup[],
  minimumLength: number,
  requiredCount: number,
): RankGroup[][] {
  const eligible = groups.filter(
    ({ rank, cards }) => rank <= ACE_RANK && cards.length >= requiredCount,
  );
  const runs: RankGroup[][] = [];
  let run: RankGroup[] = [];

  function flush(): void {
    if (run.length >= minimumLength) {
      for (let length = minimumLength; length <= run.length; length += 1) {
        for (let start = 0; start <= run.length - length; start += 1) {
          runs.push(run.slice(start, start + length));
        }
      }
    }
    run = [];
  }

  for (const group of eligible) {
    const previous = run[run.length - 1];
    if (previous && group.rank !== previous.rank + 1) flush();
    run.push(group);
  }
  flush();

  return runs;
}

function cardsFromGroups(groups: readonly RankGroup[], countPerRank: number): Card[] {
  return groups.flatMap((group) => group.cards.slice(0, countPerRank));
}

function labelFor(cards: readonly Card[]): string {
  return sortCards(cards)
    .map((card) => rankLabel(card.rank))
    .join(" ");
}

export function generateLegalPlays(
  hand: readonly Card[],
  previous: DoudizhuPattern | null = null,
): DoudizhuLegalPlay[] {
  const groups = groupsFor(hand);
  const candidates = new Map<string, DoudizhuLegalPlay>();

  function add(candidateCards: readonly Card[]): void {
    const cards = sortCards(candidateCards);
    const pattern = classifyPattern(cards);
    if (!pattern) return;
    if (previous && !canBeat(pattern, previous)) return;

    const id = `play:${cardSelectionKey(cards)}`;
    if (candidates.has(id)) return;

    candidates.set(id, {
      id,
      label: labelFor(cards),
      meta: {
        type: "play",
        cards,
        pattern,
      },
    });
  }

  for (const group of groups) {
    add(group.cards.slice(0, 1));
    if (group.cards.length >= 2) add(group.cards.slice(0, 2));
    if (group.cards.length >= 3) add(group.cards.slice(0, 3));
    if (group.cards.length === 4) add(group.cards);
  }

  const smallJoker = groups.find(({ rank }) => rank === 16);
  const bigJoker = groups.find(({ rank }) => rank === 17);
  if (smallJoker && bigJoker) {
    add([smallJoker.cards[0]!, bigJoker.cards[0]!]);
  }

  const triples = groups.filter(({ cards }) => cards.length >= 3);
  for (const triple of triples) {
    const body = triple.cards.slice(0, 3);
    for (const attachment of groups) {
      if (attachment.rank === triple.rank) continue;
      add([...body, attachment.cards[0]!]);
      if (attachment.cards.length >= 2) {
        add([...body, ...attachment.cards.slice(0, 2)]);
      }
    }
  }

  for (const sequence of consecutiveSlices(groups, 5, 1)) {
    add(cardsFromGroups(sequence, 1));
  }

  for (const sequence of consecutiveSlices(groups, 3, 2)) {
    add(cardsFromGroups(sequence, 2));
  }

  for (const bodyGroups of consecutiveSlices(groups, 2, 3)) {
    const body = cardsFromGroups(bodyGroups, 3);
    add(body);

    const bodyRanks = new Set(bodyGroups.map(({ rank }) => rank));
    const outside = groups.filter(({ rank }) => !bodyRanks.has(rank));
    const wingCount = bodyGroups.length;

    for (const wings of chooseIndividualCardsByRank(outside, wingCount)) {
      add([...body, ...wings]);
    }

    const pairGroups = outside.filter(({ cards }) => cards.length >= 2);
    for (const wingGroups of chooseRanks(pairGroups, wingCount)) {
      add([...body, ...cardsFromGroups(wingGroups, 2)]);
    }
  }

  const bombs = groups.filter(({ cards }) => cards.length === 4);
  for (const bomb of bombs) {
    const outside = groups.filter(({ rank }) => rank !== bomb.rank);

    for (const wings of chooseIndividualCardsByRank(outside, 2)) {
      add([...bomb.cards, ...wings]);
    }

    const pairGroups = outside.filter(({ cards }) => cards.length >= 2);
    for (const wingGroups of chooseRanks(pairGroups, 2)) {
      add([...bomb.cards, ...cardsFromGroups(wingGroups, 2)]);
    }
  }

  return [...candidates.values()].sort((a, b) => {
    const aMeta = a.meta;
    const bMeta = b.meta;
    if (!aMeta || !bMeta) return a.id.localeCompare(b.id);

    if (aMeta.cards.length !== bMeta.cards.length) {
      return aMeta.cards.length - bMeta.cards.length;
    }
    if (aMeta.pattern.primaryRank !== bMeta.pattern.primaryRank) {
      return aMeta.pattern.primaryRank - bMeta.pattern.primaryRank;
    }
    return a.id.localeCompare(b.id);
  });
}
