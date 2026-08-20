# Architecture

## Overview

Waitloop is a TypeScript monorepo deployed as a Cloudflare Worker with Static Assets and Durable Objects.

The system separates six responsibilities:

1. **Lifecycle adapters** observe platform-specific coding-agent signals.
2. **Protocol** converts those signals into canonical Waitloop events.
3. **CLI** manages local pairing, lifecycle adapter install, diagnostics, and room join-code exchange.
4. **Runtime** stores authoritative lifecycle/game state and enforces credentials/revisions.
5. **Games** implement pure deterministic rules behind game-agnostic contracts.
6. **Web** renders viewer-safe projections and presentation pacing; it is never authoritative.

```text
Claude Code ─┐
Cursor ──────┼─> integrations/* -> protocol -> AgentSession DO
Codex ───────┤                              -> browser status
DSH ─────────┘

browser ---------------------------> room HTTP API -> GameRoom DO
CLI join / raw MCP ----------------> join API -----┘
MCP client ------------------------> /mcp ---------┘
Hosted model ----------------------> hosted runner -> GameRoom DO
```

## Production deployment

```text
waitloop.run
  ├─ static assets
  │   ├─ /agent.md
  │   ├─ /agent.json
  │   ├─ /llms.txt
  │   ├─ /skills/waitloop/SKILL.md
  │   ├─ /game.html
  │   └─ /join/<code> (Worker-routed room onboarding)
  ├─ /api/*
  ├─ /mcp
  ├─ AgentSession Durable Objects
  ├─ DeviceRegistry Durable Object
  ├─ PairingRequest Durable Objects
  └─ GameRoom Durable Objects
```

GitHub pushes to `main` are deployed through Cloudflare's repository integration. CI independently runs a Wrangler deployment dry-run before merge.

## Package/runtime boundaries

```text
packages/protocol       pure lifecycle contracts/validation
packages/game-core      pure game-agnostic room contracts
packages/doudizhu       pure Dou Dizhu rules
packages/cli            local Node CLI/integration management
integrations/*          platform-specific lifecycle adapters
worker/*                Cloudflare APIs/DOs/MCP/hosted/join runtime
apps/web/public/*        static presentation + public Agent surfaces
```

Dependency direction must preserve these semantic rules:

- `protocol` does not depend on platform integrations or Worker code;
- `game-core` has no Cloudflare/UI dependency;
- `doudizhu` depends on pure game contracts/utilities, not Worker/MCP;
- integrations map vendor signals into `protocol` rather than adding vendor semantics to core;
- Worker orchestrates packages and owns runtime authorization/state;
- web consumes public/runtime projections and never owns game truth.

## AgentSession Durable Object

An `AgentSession` represents one logical Waitloop-tracked coding-agent work session.

Responsibilities:

- accept validated canonical lifecycle events;
- enforce duplicate/stale/terminal transition rules;
- persist minimal lifecycle/timing metadata;
- expose current snapshot;
- publish updates to authorized subscribers.

It must not require prompt/source/repository/tool/transcript content for the core experience.

## DeviceRegistry and PairingRequest

`DeviceRegistry` stores current scoped lifecycle credential digests/metadata. `PairingRequest` owns a short-lived browser approval/exchange flow.

The CLI keeps the verifier locally until exchange. Browser pairing does not put the final device credential in a URL.

## GameRoom Durable Object

A `GameRoom` owns one authoritative game instance plus runtime metadata around it.

Responsibilities:

- own/persist complete internal game state;
- associate/authenticate viewer and machine seats;
- enforce room revision, turn order, and move legality through the registered game definition;
- expose viewer-specific snapshots;
- track runtime participant/seat state;
- implement connected-agent lobby/join readiness outside the game-rules package;
- run deterministic/hosted automated seats;
- pause/resume when linked work attention changes;
- broadcast authorized machine snapshots where applicable.

`GameRoom` must not implement Dou Dizhu pattern/rule branching.

## Game vs runtime phase

The generic game/room state understands:

```text
playing | paused | finished
```

The Worker adds connected-agent onboarding phase:

```text
waiting_for_players -> playing -> paused -> playing -> finished
```

Seat readiness (`waiting`, `connecting`, `connected`, `ready`) is runtime metadata. It does not belong in `packages/doudizhu`.

During `waiting_for_players`, human projection hides pre-start hand/landlord information even if internal game state has already been prepared.

## Connected-agent join architecture

```text
browser creates connected-agent room
  -> high-entropy WL-... join code
  -> room remains waiting_for_players

path A:
  waitloop join <code>

path B:
  /join/<code> -> raw MCP configuration

claim
  -> one wlseat_... credential
  -> seat connecting
  -> configure /mcp with Authorization + X-Waitloop-Room
  -> first authenticated MCP request
  -> seat connected
  -> room starts
```

The join code is a one-time issuance capability. The resulting seat token is the ongoing room credential.

## Human and machine game paths

### Browser human

```text
viewer cookie
  -> human-safe snapshot
  -> card selection / play / pass / hint
  -> Worker resolves to current legal move
  -> GameRoom applies authoritative transition
```

### MCP agent

```text
room + wlseat transport credentials
  -> get_turn()
  -> viewer-specific machine snapshot + legal move IDs
  -> play_move(expectedRevision, moveId)
  -> GameRoom validates/applies
```

### Hosted agent

```text
GameRoom current hosted seat
  -> viewer-specific machine snapshot
  -> hosted provider selects move ID
  -> invalid/error/timeout => deterministic legal fallback
```

## Trust boundaries

Every external boundary validates untrusted input:

- adapter -> lifecycle ingest;
- browser pairing -> PairingRequest;
- browser -> room APIs;
- join code -> seat-credential issuance;
- MCP client -> room-bound tool handler;
- hosted model output -> legal move selection;
- persisted Durable Object data -> versioned/normalized runtime state.

Types do not replace runtime validation.

## Concurrency/revision model

Durable Objects serialize requests per object, while explicit room/session revisions protect clients from stale decisions and make rejection deterministic.

Never rely on “request ordering probably works” as the only stale-state defense.

## Persistence

Persist only data required to recover current active resources. Persisted schemas remain versioned/normalizable and must not depend on serialized class instances.

Changes to persisted Durable Object shapes require migration/recovery consideration and tests as the system approaches broader public usage.

## Observability

Structured logs should contain opaque identifiers, transition outcomes, error codes, and aggregate model usage—not private user content, raw credentials, prompts, source, or hidden game hands.

## Failure behavior

Waitloop fails open with respect to the user's primary work:

- Waitloop outage must not block the coding agent;
- lifecycle hook failures are bounded/best-effort;
- game failure must not hide an actionable coding-agent state;
- hosted model failure falls back at the game layer rather than blocking indefinitely;
- casual connected-agent waiting is allowed to be long, with soft UI reminders rather than a forced timer.