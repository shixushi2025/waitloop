import { describe, expect, it } from "vitest";

import {
  parseWaitloopAgentEvent,
  reduceAgentEvent,
  type WaitloopAgentEventV1,
} from "./index";

function makeEvent(overrides: Partial<WaitloopAgentEventV1> = {}): WaitloopAgentEventV1 {
  const base: WaitloopAgentEventV1 = {
    version: 1,
    eventId: "evt-1",
    sessionId: "session-1",
    agent: "claude-code",
    state: "running",
    occurredAt: 1_000,
    sequence: 1,
  };

  return { ...base, ...overrides } as WaitloopAgentEventV1;
}

describe("parseWaitloopAgentEvent", () => {
  it("parses the minimal canonical event", () => {
    const parsed = parseWaitloopAgentEvent({
      version: 1,
      eventId: "evt-1",
      sessionId: "session-1",
      agent: "codex",
      state: "running",
      occurredAt: 1_000,
    });

    expect(parsed).toEqual({
      ok: true,
      value: {
        version: 1,
        eventId: "evt-1",
        sessionId: "session-1",
        agent: "codex",
        state: "running",
        occurredAt: 1_000,
      },
    });
  });

  it("rejects unknown fields so adapters cannot accidentally send prompt content", () => {
    const parsed = parseWaitloopAgentEvent({
      version: 1,
      eventId: "evt-1",
      sessionId: "session-1",
      agent: "codex",
      state: "running",
      occurredAt: 1_000,
      prompt: "private prompt text",
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe("unknown_field");
      expect(parsed.error.field).toBe("prompt");
    }
  });

  it("rejects invalid timestamps and sequences", () => {
    expect(
      parseWaitloopAgentEvent({
        version: 1,
        eventId: "evt-1",
        sessionId: "session-1",
        agent: "cursor",
        state: "waiting",
        occurredAt: -1,
      }).ok,
    ).toBe(false);
  });
});

describe("reduceAgentEvent", () => {
  it("creates a session snapshot from the first event", () => {
    const result = reduceAgentEvent(null, makeEvent());

    expect(result.accepted).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.decision).toBe("created");
    expect(result.state?.snapshot).toMatchObject({
      sessionId: "session-1",
      agent: "claude-code",
      state: "running",
      revision: 1,
      startedAt: 1_000,
    });
  });

  it("treats duplicate event IDs idempotently", () => {
    const created = reduceAgentEvent(null, makeEvent());
    const duplicate = reduceAgentEvent(created.state, makeEvent());

    expect(duplicate.accepted).toBe(true);
    expect(duplicate.changed).toBe(false);
    expect(duplicate.decision).toBe("duplicate");
    expect(duplicate.state?.snapshot.revision).toBe(1);
  });

  it("supports running -> waiting -> running -> completed", () => {
    const created = reduceAgentEvent(null, makeEvent());
    const waiting = reduceAgentEvent(
      created.state,
      makeEvent({ eventId: "evt-2", state: "waiting", occurredAt: 2_000, sequence: 2 }),
    );
    const resumed = reduceAgentEvent(
      waiting.state,
      makeEvent({ eventId: "evt-3", state: "running", occurredAt: 3_000, sequence: 3 }),
    );
    const completed = reduceAgentEvent(
      resumed.state,
      makeEvent({ eventId: "evt-4", state: "completed", occurredAt: 4_000, sequence: 4 }),
    );

    expect(completed.state?.snapshot).toMatchObject({
      state: "completed",
      revision: 4,
      finishedAt: 4_000,
    });
  });

  it("rejects a stale sequence", () => {
    const created = reduceAgentEvent(null, makeEvent({ sequence: 10 }));
    const stale = reduceAgentEvent(
      created.state,
      makeEvent({ eventId: "evt-2", state: "waiting", occurredAt: 2_000, sequence: 9 }),
    );

    expect(stale.accepted).toBe(false);
    expect(stale.decision).toBe("stale");
    expect(stale.state?.snapshot.state).toBe("running");
  });

  it("records same-state ordering without incrementing the public revision", () => {
    const created = reduceAgentEvent(null, makeEvent());
    const heartbeat = reduceAgentEvent(
      created.state,
      makeEvent({ eventId: "evt-2", occurredAt: 2_000, sequence: 2 }),
    );

    expect(heartbeat.accepted).toBe(true);
    expect(heartbeat.changed).toBe(false);
    expect(heartbeat.decision).toBe("same_state");
    expect(heartbeat.state?.snapshot.revision).toBe(1);
    expect(heartbeat.state?.lastSequence).toBe(2);
  });

  it("does not allow a terminal session to restart", () => {
    const created = reduceAgentEvent(null, makeEvent());
    const completed = reduceAgentEvent(
      created.state,
      makeEvent({ eventId: "evt-2", state: "completed", occurredAt: 2_000, sequence: 2 }),
    );
    const restarted = reduceAgentEvent(
      completed.state,
      makeEvent({ eventId: "evt-3", state: "running", occurredAt: 3_000, sequence: 3 }),
    );

    expect(restarted.accepted).toBe(false);
    expect(restarted.decision).toBe("terminal");
    expect(restarted.state?.snapshot.state).toBe("completed");
  });

  it("rejects an event that changes the agent identity for a session", () => {
    const created = reduceAgentEvent(null, makeEvent());
    const mismatch = reduceAgentEvent(
      created.state,
      makeEvent({ eventId: "evt-2", agent: "cursor", occurredAt: 2_000, sequence: 2 }),
    );

    expect(mismatch.accepted).toBe(false);
    expect(mismatch.decision).toBe("agent_mismatch");
  });
});
