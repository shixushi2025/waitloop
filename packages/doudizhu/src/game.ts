import type { GameDefinition, LegalMove } from "@waitloop/game-core";

import { sortCards, type Card } from "./card";
import { createDeck, dealDeck, shuffleDeck } from "./deck";
import {
  generateLegalPlays,
  type DoudizhuMoveMeta,
} from "./move-generator";
import type {
  DoudizhuCreateInput,
  DoudizhuHistoryEntry,
  DoudizhuPlayHistoryEntry,
  DoudizhuPublicStateV1,
  DoudizhuRole,
  DoudizhuStateV1,
} from "./state";

export interface DoudizhuPassMoveMeta {
  type: "pass";
}

export type DoudizhuGameMoveMeta = DoudizhuMoveMeta | DoudizhuPassMoveMeta;

function assertPlayers(input: DoudizhuCreateInput): void {
  const unique = new Set(input.playerIds);
  if (unique.size !== 3 || input.playerIds.some((id) => id.length === 0)) {
    throw new Error("Dou Dizhu requires exactly three distinct non-empty player IDs.");
  }
  if (!unique.has(input.landlordId)) {
    throw new Error("landlordId must identify one of the three players.");
  }
}

function nextIndex(index: number): number {
  return (index + 1) % 3;
}

function currentPlayerId(state: DoudizhuStateV1): string | null {
  if (state.winnerId !== undefined) return null;
  return state.players[state.currentPlayerIndex] ?? null;
}

function roleFor(state: DoudizhuStateV1, playerId: string): DoudizhuRole {
  return state.landlordId === playerId ? "landlord" : "farmer";
}

function clonePlay(entry: DoudizhuPlayHistoryEntry | null): DoudizhuPlayHistoryEntry | null {
  if (entry === null) return null;
  return {
    ...entry,
    cards: sortCards(entry.cards),
    pattern: { ...entry.pattern },
  };
}

function cloneHistory(history: readonly DoudizhuHistoryEntry[]): DoudizhuHistoryEntry[] {
  return history.map((entry) =>
    entry.type === "pass"
      ? { ...entry }
      : {
          ...entry,
          cards: sortCards(entry.cards),
          pattern: { ...entry.pattern },
        },
  );
}

function removeCards(hand: readonly Card[], selected: readonly Card[]): Card[] {
  const selectedIds = new Set(selected.map((card) => card.id));
  if (selectedIds.size !== selected.length) {
    throw new Error("Selected cards contain duplicate IDs.");
  }

  const handIds = new Set(hand.map((card) => card.id));
  for (const id of selectedIds) {
    if (!handIds.has(id)) {
      throw new Error(`Selected card ${id} is not in the player's hand.`);
    }
  }

  return sortCards(hand.filter((card) => !selectedIds.has(card.id)));
}

function buildInitialState(input: DoudizhuCreateInput): DoudizhuStateV1 {
  assertPlayers(input);

  const deck = input.deck ? [...input.deck] : shuffleDeck(createDeck());
  const deal = dealDeck(deck);
  const hands: Record<string, Card[]> = {};

  input.playerIds.forEach((playerId, index) => {
    const hand = deal.hands[index];
    if (hand === undefined) throw new Error("Deal invariant failed.");
    hands[playerId] = sortCards(hand);
  });

  const landlordHand = hands[input.landlordId];
  if (!landlordHand) throw new Error("Landlord hand invariant failed.");
  hands[input.landlordId] = sortCards([...landlordHand, ...deal.bottom]);

  const landlordIndex = input.playerIds.indexOf(input.landlordId);
  if (landlordIndex < 0) throw new Error("Landlord index invariant failed.");

  return {
    version: 1,
    players: [...input.playerIds],
    landlordId: input.landlordId,
    hands,
    currentPlayerIndex: landlordIndex,
    lastPlay: null,
    passesSinceLastPlay: 0,
    history: [],
  };
}

function legalMoves(
  state: DoudizhuStateV1,
  playerId: string,
): LegalMove<DoudizhuGameMoveMeta>[] {
  if (state.winnerId !== undefined || currentPlayerId(state) !== playerId) return [];

  const hand = state.hands[playerId];
  if (!hand) return [];

  const moves: LegalMove<DoudizhuGameMoveMeta>[] = generateLegalPlays(
    hand,
    state.lastPlay?.pattern ?? null,
  );

  if (state.lastPlay !== null) {
    moves.push({
      id: "pass",
      label: "pass",
      meta: { type: "pass" },
    });
  }

  return moves;
}

function applyPass(state: DoudizhuStateV1, playerId: string): DoudizhuStateV1 {
  if (state.lastPlay === null) {
    throw new Error("Cannot pass when leading a trick.");
  }

  const history: DoudizhuHistoryEntry[] = [...state.history, { type: "pass", playerId }];
  const secondPass = state.passesSinceLastPlay >= 1;

  return {
    ...state,
    currentPlayerIndex: nextIndex(state.currentPlayerIndex),
    lastPlay: secondPass ? null : state.lastPlay,
    passesSinceLastPlay: secondPass ? 0 : state.passesSinceLastPlay + 1,
    history,
  };
}

function applyPlay(
  state: DoudizhuStateV1,
  playerId: string,
  moveId: string,
): DoudizhuStateV1 {
  const hand = state.hands[playerId];
  if (!hand) throw new Error("Player hand does not exist.");

  const move = generateLegalPlays(hand, state.lastPlay?.pattern ?? null).find(
    (candidate) => candidate.id === moveId,
  );
  if (!move?.meta) throw new Error("Move is not legal in the current state.");

  const nextHand = removeCards(hand, move.meta.cards);
  const play: DoudizhuPlayHistoryEntry = {
    type: "play",
    playerId,
    cards: sortCards(move.meta.cards),
    pattern: { ...move.meta.pattern },
  };

  const hands: Record<string, Card[]> = {
    ...state.hands,
    [playerId]: nextHand,
  };
  const winnerId = nextHand.length === 0 ? playerId : undefined;

  const next: DoudizhuStateV1 = {
    ...state,
    hands,
    currentPlayerIndex: nextIndex(state.currentPlayerIndex),
    lastPlay: play,
    passesSinceLastPlay: 0,
    history: [...state.history, play],
  };

  if (winnerId !== undefined) {
    next.winnerId = winnerId;
  }

  return next;
}

export const doudizhuGame: GameDefinition<
  DoudizhuStateV1,
  DoudizhuPublicStateV1,
  DoudizhuCreateInput,
  DoudizhuGameMoveMeta
> = {
  id: "doudizhu",

  create(input) {
    return buildInitialState(input);
  },

  getStatus(state) {
    return state.winnerId === undefined ? "playing" : "finished";
  },

  getPlayerIds(state) {
    return state.players;
  },

  getCurrentPlayerId(state) {
    return currentPlayerId(state);
  },

  getPublicState(state, viewerId) {
    if (!state.players.includes(viewerId)) {
      throw new Error("Viewer is not a player in this game.");
    }

    const hand = state.hands[viewerId];
    if (!hand) throw new Error("Viewer hand invariant failed.");

    const view: DoudizhuPublicStateV1 = {
      version: 1,
      role: roleFor(state, viewerId),
      landlordId: state.landlordId,
      myHand: sortCards(hand),
      players: state.players.map((id) => ({
        id,
        role: roleFor(state, id),
        remaining: state.hands[id]?.length ?? 0,
      })),
      currentPlayerId: currentPlayerId(state),
      lastPlay: clonePlay(state.lastPlay),
      passesSinceLastPlay: state.passesSinceLastPlay,
      history: cloneHistory(state.history),
    };

    if (state.winnerId !== undefined) {
      view.winnerId = state.winnerId;
    }

    return view;
  },

  getLegalMoves(state, playerId) {
    return legalMoves(state, playerId);
  },

  applyMove(state, playerId, moveId) {
    if (state.winnerId !== undefined) throw new Error("Game is already finished.");
    if (currentPlayerId(state) !== playerId) throw new Error("It is not this player's turn.");

    if (moveId === "pass") {
      return applyPass(state, playerId);
    }

    return applyPlay(state, playerId, moveId);
  },
};
