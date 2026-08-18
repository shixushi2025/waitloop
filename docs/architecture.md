# Architecture

## Overview

Waitloop is split into four layers:

1. **Adapters** observe platform-specific agent lifecycle signals.
2. **Protocol** converts those signals into canonical Waitloop events.
3. **Runtime** stores live agent/game state and pushes updates to clients.
4. **Games** implement deterministic domain rules behind game-agnostic contracts.

```text
Claude Code ─┐
Cursor ──────┼─> integrations/* ─> Waitloop Agent Event
Codex ───────┤                              │
DSH ─────────┘                              ▼
                                      AgentSession DO
                                             │
                                          WebSocket
                                             │
                                             ▼
                                         Web client
                                             │
                                             ▼
                                        GameRoom DO
                                             ▲
                                             │
                                    MCP / HTTP game API
                                             │
                                             ▼
                                           Agent
```

## Deployment model

The first production target is a single Cloudflare Worker deployment with static assets and Durable Objects.

```text
waitloop.run
  ├─ static assets
  ├─ /api/*
  ├─ /mcp
  ├─ AgentSession Durable Objects
  └─ GameRoom Durable Objects
```

This keeps deployment and routing simple while preserving state isolation by Durable Object ID.

## AgentSession Durable Object

An `AgentSession` represents one logical run/session of one coding agent.

Responsibilities:

- accept validated canonical lifecycle events
- enforce monotonic/event-safe state transitions
- record minimal timing metadata
- expose current public state
- push state changes to connected web clients over WebSocket

It must not store source code, prompts, repository files, terminal output, or tool arguments for the core experience.

Suggested public state:

```ts
interface AgentSessionSnapshot {
  sessionId: string;
  agent: AgentKind;
  state: AgentState;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
}
```

## GameRoom Durable Object

A `GameRoom` owns one authoritative game instance.

Responsibilities:

- own the complete internal game state
- authenticate/associate players with seats
- enforce turn ordering
- call the game engine for legal state transitions
- expose per-player public views
- broadcast public room events
- pause/resume when linked agent sessions change attention state

GameRoom does not implement game rules directly. It delegates to a game implementation that conforms to `packages/game-core`.

## Package dependency rules

Allowed direction:

```text
protocol         game-core
   ▲                 ▲
   │                 │
integrations      doudizhu
   │                 │
   └──────┐     ┌────┘
          ▼     ▼
           worker
             │
             ▼
             web
```

The exact build graph may vary, but these semantic rules do not:

- `protocol` has no runtime/platform dependency.
- `game-core` has no Cloudflare or UI dependency.
- `doudizhu` depends only on `game-core` and pure utilities.
- integrations depend on `protocol`, not on Worker internals.
- the web client consumes public API types; it is never authoritative.

## Trust boundaries

Every boundary must validate untrusted input:

- adapter -> HTTP endpoint
- MCP client -> tool handler
- browser -> game command API
- WebSocket client -> runtime
- persisted Durable Object state -> migration/version decoder

Types alone are not validation. Runtime validation is required before mutation.

## Event flow

### Agent lifecycle

```text
platform hook
   ↓
adapter maps event
   ↓
POST /api/v1/agent-events
   ↓
validate WaitloopAgentEvent
   ↓
route by sessionId
   ↓
AgentSession DO
   ↓
persist snapshot
   ↓
WebSocket broadcast
```

### Game move

```text
human UI or MCP client
   ↓
moveId
   ↓
GameRoom DO
   ↓
check room/player/turn/version
   ↓
engine.applyMove(moveId)
   ↓
persist next internal state
   ↓
derive public views
   ↓
broadcast
```

## Concurrency model

Durable Objects serialize requests to a specific object, which makes them a natural authority boundary for a session or game room. The application should still include an explicit monotonically increasing `version` in snapshots and commands so stale clients can be detected and rejected deterministically.

## Persistence model

Persist only state required to recover an active room/session. Keep durable schemas versioned from the beginning:

```ts
interface PersistedEnvelope<T> {
  schemaVersion: number;
  value: T;
}
```

Do not rely on serialized class instances.

## Observability

Structured logs should include identifiers and state transitions, not private user content.

Good:

```json
{"type":"agent.transition","sessionId":"...","from":"running","to":"completed"}
```

Bad:

```json
{"prompt":"fix auth.ts and here is the whole source..."}
```

## Failure behavior

Waitloop must fail open with respect to the user's work:

- If Waitloop is unavailable, the coding agent continues normally.
- If a game fails, agent status remains visible.
- If a lifecycle adapter cannot report, it must not block or delay the coding agent.
- Integration hooks should have strict timeouts and best-effort delivery unless a platform explicitly guarantees asynchronous hooks.
