import {
  AGENT_KINDS,
  AGENT_STATES,
  type AgentKind,
  type AgentState,
  type WaitloopAgentEventV1,
} from "./agent";

export interface ProtocolValidationError {
  code: "invalid_type" | "invalid_value" | "unknown_field";
  field: string;
  message: string;
}

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ProtocolValidationError };

const AGENT_KIND_SET: ReadonlySet<string> = new Set(AGENT_KINDS);
const AGENT_STATE_SET: ReadonlySet<string> = new Set(AGENT_STATES);
const AGENT_EVENT_FIELDS = new Set([
  "version",
  "eventId",
  "sessionId",
  "agent",
  "state",
  "occurredAt",
  "sequence",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBoundedString(
  input: Record<string, unknown>,
  field: string,
  maxLength: number,
): ParseResult<string> {
  const value = input[field];

  if (typeof value !== "string") {
    return {
      ok: false,
      error: { code: "invalid_type", field, message: `${field} must be a string.` },
    };
  }

  if (value.length === 0 || value.length > maxLength) {
    return {
      ok: false,
      error: {
        code: "invalid_value",
        field,
        message: `${field} must contain between 1 and ${maxLength} characters.`,
      },
    };
  }

  return { ok: true, value };
}

function readNonNegativeInteger(
  input: Record<string, unknown>,
  field: string,
): ParseResult<number> {
  const value = input[field];

  if (typeof value !== "number") {
    return {
      ok: false,
      error: { code: "invalid_type", field, message: `${field} must be a number.` },
    };
  }

  if (!Number.isSafeInteger(value) || value < 0) {
    return {
      ok: false,
      error: {
        code: "invalid_value",
        field,
        message: `${field} must be a non-negative safe integer.`,
      },
    };
  }

  return { ok: true, value };
}

export function parseWaitloopAgentEvent(input: unknown): ParseResult<WaitloopAgentEventV1> {
  if (!isRecord(input)) {
    return {
      ok: false,
      error: { code: "invalid_type", field: "$", message: "Event body must be an object." },
    };
  }

  for (const field of Object.keys(input)) {
    if (!AGENT_EVENT_FIELDS.has(field)) {
      return {
        ok: false,
        error: {
          code: "unknown_field",
          field,
          message: `Unknown agent event field: ${field}.`,
        },
      };
    }
  }

  if (input.version !== 1) {
    return {
      ok: false,
      error: { code: "invalid_value", field: "version", message: "version must be 1." },
    };
  }

  const eventId = readBoundedString(input, "eventId", 128);
  if (!eventId.ok) return eventId;

  const sessionId = readBoundedString(input, "sessionId", 128);
  if (!sessionId.ok) return sessionId;

  if (typeof input.agent !== "string" || !AGENT_KIND_SET.has(input.agent)) {
    return {
      ok: false,
      error: { code: "invalid_value", field: "agent", message: "Unknown agent kind." },
    };
  }

  if (typeof input.state !== "string" || !AGENT_STATE_SET.has(input.state)) {
    return {
      ok: false,
      error: { code: "invalid_value", field: "state", message: "Unknown agent state." },
    };
  }

  const occurredAt = readNonNegativeInteger(input, "occurredAt");
  if (!occurredAt.ok) return occurredAt;

  let sequence: number | undefined;
  if (input.sequence !== undefined) {
    const parsedSequence = readNonNegativeInteger(input, "sequence");
    if (!parsedSequence.ok) return parsedSequence;
    sequence = parsedSequence.value;
  }

  const value: WaitloopAgentEventV1 = {
    version: 1,
    eventId: eventId.value,
    sessionId: sessionId.value,
    agent: input.agent as AgentKind,
    state: input.state as AgentState,
    occurredAt: occurredAt.value,
  };

  if (sequence !== undefined) {
    value.sequence = sequence;
  }

  return { ok: true, value };
}
