export type GameActorKindV1 =
  | "human"
  | "bot"
  | "hosted-agent"
  | "connected-agent";

export type GameParticipantKindV1 = GameActorKindV1;
export type GameSeatStatusV1 = "ready" | "waiting" | "connecting" | "connected" | "disconnected";
export type GameActorRelationV1 = "controller" | "advisor";
export type GameCapabilityV1 =
  | "room:view-public"
  | "room:manage"
  | "seat:view-private"
  | "seat:inspect-legal"
  | "seat:play"
  | "seat:control"
  | "room:comment";

export type HostedAgentIdV1 = "deepseek" | "openai";

export interface GameActorV1 {
  version: 1;
  id: string;
  kind: GameActorKindV1;
  label: string;
  temporary?: boolean;
  hostedAgentId?: HostedAgentIdV1;
  provider?: "deepseek" | "openai";
  model?: string;
}

// Compatibility name for older browser/runtime projections. A participant is
// now an actor; seats are modeled separately by GameSeatV1.
export type GameParticipantV1 = GameActorV1;

export interface GameSeatV1 {
  version: 1;
  id: string;
  label: string;
  ownerActorId: string;
  activeControllerActorId: string;
}

export interface GameActorBindingV1 {
  version: 1;
  actorId: string;
  seatId: string;
  relation: GameActorRelationV1;
}

export interface GameActorRuntimeV1 {
  version: 1;
  actorId: string;
  status: GameSeatStatusV1;
  statusChangedAt: number;
  connectedAt?: number;
  disconnectedAt?: number;
  lastSeenAt?: number;
}

// Legacy compatibility projection consumed by the current browser while room
// snapshots migrate to actorStates.
export interface GameSeatRuntimeV1 {
  version: 1;
  playerId: string;
  status: GameSeatStatusV1;
  statusChangedAt: number;
  connectedAt?: number;
}

export interface GameRoomCommentV1 {
  version: 1;
  id: string;
  actorId: string;
  text: string;
  createdAt: number;
}

export interface HostedAgentRuntimeStatsV1 {
  version: 1;
  playerId: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalLatencyMs: number;
  fallbackMoves: number;
  lastError?: string;
}

export interface HostedAgentDescriptorV1 {
  version: 1;
  id: HostedAgentIdV1;
  label: string;
  provider: "deepseek" | "openai";
  model: string;
}

export function isHostedAgentId(value: unknown): value is HostedAgentIdV1 {
  return value === "deepseek" || value === "openai";
}
