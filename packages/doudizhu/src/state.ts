import type { Card } from "./card";
import type { DoudizhuPattern } from "./pattern";

export type DoudizhuRole = "landlord" | "farmer";

export interface DoudizhuPlayHistoryEntry {
  type: "play";
  playerId: string;
  cards: Card[];
  pattern: DoudizhuPattern;
}

export interface DoudizhuPassHistoryEntry {
  type: "pass";
  playerId: string;
}

export type DoudizhuHistoryEntry = DoudizhuPlayHistoryEntry | DoudizhuPassHistoryEntry;

export interface DoudizhuStateV1 {
  version: 1;
  players: [string, string, string];
  landlordId: string;
  hands: Record<string, Card[]>;
  currentPlayerIndex: number;
  lastPlay: DoudizhuPlayHistoryEntry | null;
  passesSinceLastPlay: number;
  history: DoudizhuHistoryEntry[];
  winnerId?: string;
}

export interface DoudizhuPublicPlayer {
  id: string;
  role: DoudizhuRole;
  remaining: number;
}

export interface DoudizhuPublicStateV1 {
  version: 1;
  role: DoudizhuRole;
  landlordId: string;
  myHand: Card[];
  players: DoudizhuPublicPlayer[];
  currentPlayerId: string | null;
  lastPlay: DoudizhuPlayHistoryEntry | null;
  passesSinceLastPlay: number;
  history: DoudizhuHistoryEntry[];
  winnerId?: string;
}

export interface DoudizhuCreateInput {
  playerIds: [string, string, string];
  landlordId: string;
  deck?: Card[];
}
