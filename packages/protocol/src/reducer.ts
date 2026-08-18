import {
  TERMINAL_AGENT_STATES,
  type AgentSessionSnapshotV1,
  type AgentSessionStateV1,
  type AgentState,
  type WaitloopAgentEventV1,
} from "./agent";

export type AgentEventDecision =
  | "created"
  | "transitioned"
  | "duplicate"
  | "same_state"
  | "stale"
  | "terminal"
  | "session_mismatch"
  | "agent_mismatch";

export interface AgentEventReduction {
  accepted: boolean;
  changed: boolean;
  decision: AgentEventDecision;
  state: AgentSessionStateV1 | null;
}

const RECENT_EVENT_LIMIT = 64;

function appendRecentEventId(ids: readonly string[], eventId: string): string[] {
  const next = [...ids, eventId];
  if (next.length <= RECENT_EVENT_LIMIT) {
    return next;
  }
  return next.slice(next.length - RECENT_EVENT_LIMIT);
}

function isAllowedTransition(from: AgentState, to: AgentState): boolean {
  if (from === to) return true;
  if (TERMINAL_AGENT_STATES.has(from)) return false;

  switch (from) {
    case "idle":
      return to === "running" || to === "waiting" || to === "completed" || to === "failed";
    case "running":
      return to === "waiting" || to === "completed" || to === "failed";
    case "waiting":
      return to === "running" || to === "completed" || to === "failed";
    case "completed":
    case "failed":
      return false;
  }
}

function withEventOrdering(
  current: AgentSessionStateV1,
  event: WaitloopAgentEventV1,
): AgentSessionStateV1 {
  const next: AgentSessionStateV1 = {
    ...current,
    lastOccurredAt: Math.max(current.lastOccurredAt, event.occurredAt),
    recentEventIds: appendRecentEventId(current.recentEventIds, event.eventId),
  };

  if (event.sequence !== undefined) {
    next.lastSequence = event.sequence;
  }

  return next;
}

function createState(event: WaitloopAgentEventV1): AgentSessionStateV1 {
  const snapshot: AgentSessionSnapshotV1 = {
    version: 1,
    sessionId: event.sessionId,
    agent: event.agent,
    state: event.state,
    startedAt: event.occurredAt,
    updatedAt: event.occurredAt,
    revision: 1,
  };

  if (TERMINAL_AGENT_STATES.has(event.state)) {
    snapshot.finishedAt = event.occurredAt;
  }

  const state: AgentSessionStateV1 = {
    version: 1,
    snapshot,
    lastOccurredAt: event.occurredAt,
    recentEventIds: [event.eventId],
  };

  if (event.sequence !== undefined) {
    state.lastSequence = event.sequence;
  }

  return state;
}

export function reduceAgentEvent(
  current: AgentSessionStateV1 | null,
  event: WaitloopAgentEventV1,
): AgentEventReduction {
  if (current === null) {
    return {
      accepted: true,
      changed: true,
      decision: "created",
      state: createState(event),
    };
  }

  if (current.snapshot.sessionId !== event.sessionId) {
    return {
      accepted: false,
      changed: false,
      decision: "session_mismatch",
      state: current,
    };
  }

  if (current.snapshot.agent !== event.agent) {
    return {
      accepted: false,
      changed: false,
      decision: "agent_mismatch",
      state: current,
    };
  }

  if (current.recentEventIds.includes(event.eventId)) {
    return {
      accepted: true,
      changed: false,
      decision: "duplicate",
      state: current,
    };
  }

  if (
    event.sequence !== undefined &&
    current.lastSequence !== undefined &&
    event.sequence <= current.lastSequence
  ) {
    return {
      accepted: false,
      changed: false,
      decision: "stale",
      state: current,
    };
  }

  if (event.sequence === undefined && event.occurredAt < current.lastOccurredAt) {
    return {
      accepted: false,
      changed: false,
      decision: "stale",
      state: current,
    };
  }

  if (TERMINAL_AGENT_STATES.has(current.snapshot.state)) {
    return {
      accepted: false,
      changed: false,
      decision: "terminal",
      state: current,
    };
  }

  if (!isAllowedTransition(current.snapshot.state, event.state)) {
    return {
      accepted: false,
      changed: false,
      decision: "terminal",
      state: current,
    };
  }

  if (current.snapshot.state === event.state) {
    return {
      accepted: true,
      changed: false,
      decision: "same_state",
      state: withEventOrdering(current, event),
    };
  }

  const snapshot: AgentSessionSnapshotV1 = {
    ...current.snapshot,
    state: event.state,
    updatedAt: event.occurredAt,
    revision: current.snapshot.revision + 1,
  };

  if (current.snapshot.state === "idle" && event.state === "running") {
    snapshot.startedAt = event.occurredAt;
  }

  if (TERMINAL_AGENT_STATES.has(event.state)) {
    snapshot.finishedAt = event.occurredAt;
  } else {
    delete snapshot.finishedAt;
  }

  const ordered = withEventOrdering(current, event);

  return {
    accepted: true,
    changed: true,
    decision: "transitioned",
    state: {
      ...ordered,
      snapshot,
    },
  };
}
