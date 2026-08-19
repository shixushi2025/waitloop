export type GameParticipantKindV1 =
  | "human"
  | "bot"
  | "hosted-agent"
  | "connected-agent";

export type GameSeatStatusV1 = "ready" | "waiting" | "connecting" | "connected";
export type HostedAgentIdV1 = "deepseek" | "openai";

export interface GameParticipantV1 {
  version: 1;
  id: string;
  kind: GameParticipantKindV1;
  label: string;
  hostedAgentId?: HostedAgentIdV1;
  provider?: "deepseek" | "openai";
  model?: string;
}

export interface GameSeatRuntimeV1 {
  version: 1;
  playerId: string;
  status: GameSeatStatusV1;
  statusChangedAt: number;
  connectedAt?: number;
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
