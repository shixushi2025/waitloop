export const AGENT_KINDS = [
  "claude-code",
  "codex",
  "cursor",
  "dsh",
  "unknown",
] as const;

export type AgentKind = (typeof AGENT_KINDS)[number];

export const AGENT_STATES = [
  "idle",
  "running",
  "waiting",
  "completed",
  "failed",
] as const;

export type AgentState = (typeof AGENT_STATES)[number];

export interface WaitloopAgentEventV1 {
  version: 1;
  eventId: string;
  sessionId: string;
  agent: AgentKind;
  state: AgentState;
  occurredAt: number;
  sequence?: number;
}

export interface AgentSessionSnapshotV1 {
  version: 1;
  sessionId: string;
  agent: AgentKind;
  state: AgentState;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  revision: number;
}

export interface AgentSessionStateV1 {
  version: 1;
  snapshot: AgentSessionSnapshotV1;
  lastOccurredAt: number;
  lastSequence?: number;
  recentEventIds: string[];
}

export const TERMINAL_AGENT_STATES: ReadonlySet<AgentState> = new Set([
  "completed",
  "failed",
]);
