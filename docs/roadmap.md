# Roadmap

This roadmap is ordered by dependency and proof value. A phase is complete only when its acceptance criteria pass; later phases should not bypass an incomplete core invariant.

## Phase 0 — Product contract

Status: **in progress**

Deliverables:

- product definition and non-goals
- architecture boundaries
- canonical lifecycle protocol
- game-system contract
- privacy/security baseline
- visual language
- repository instructions for coding agents

Acceptance:

- a new contributor can explain what belongs in integrations, core, worker, and game packages
- documentation makes clear that MCP is not the lifecycle detector
- documentation makes clear that Waitloop does not need prompt/source content

## Phase 1 — Workspace foundation

Deliverables:

- pnpm workspace
- strict shared TypeScript config
- build/typecheck/test scripts
- Worker entry point
- Cloudflare configuration
- minimal static web app

Acceptance:

```bash
pnpm install
pnpm typecheck
pnpm test
```

complete successfully on a clean checkout.

## Phase 2 — Agent event protocol

Deliverables:

- protocol types
- runtime validators
- state-transition reducer
- unit tests for duplicates, stale events, terminal states, and revisions

Acceptance:

- external JSON cannot mutate session state without validation
- duplicate event IDs are idempotent
- sequence/timestamp staleness behavior is deterministic

## Phase 3 — AgentSession runtime

Deliverables:

- `POST /api/v1/agent-events`
- AgentSession Durable Object
- snapshot endpoint
- WebSocket subscribers
- minimal event/status UI

Acceptance demo:

```text
curl/event producer -> Worker -> AgentSession DO -> browser updates in real time
```

No source/prompt content is sent.

## Phase 4 — First real adapter

Target: **Claude Code first**

Deliverables:

- installable adapter/plugin structure
- lifecycle mapping into protocol v1
- bounded/non-blocking event delivery
- install/uninstall documentation

Acceptance demo:

```text
real Claude Code task starts
-> waitloop shows running
real task stops/waits
-> waitloop interrupts the waiting UI
```

## Phase 5 — Generic game runtime

Deliverables:

- game-core interfaces
- authoritative room revision model
- GameRoom Durable Object skeleton
- viewer-specific snapshots
- legal move / stale move handling

Acceptance:

- a trivial test game can run without any Dou Dizhu-specific code in GameRoom
- stale move revisions are rejected

## Phase 6 — Dou Dizhu engine

Deliverables:

- card/deck model
- deterministic deal support
- pattern classification
- pattern comparison
- legal move generation
- bidding/play state machine
- viewer-specific public state
- regression-heavy unit tests

Acceptance:

- complete legal game can be simulated deterministically to a winner
- hidden cards cannot appear in another player's public projection
- bombs/rocket and core combination rules are covered by tests

## Phase 7 — Web game UI

Deliverables:

- Waitloop shell
- Dou Dizhu room view
- keyboard and pointer move selection
- pause/return behavior when linked agent state changes
- responsive layout

Acceptance demo:

```text
agent running
-> user enters Dou Dizhu
-> game in progress
-> agent waiting/completed
-> game pauses and return-to-work dominates UI
```

## Phase 8 — MCP participation

Deliverables:

- remote MCP endpoint
- `get_turn`
- `play_move`
- player/session authorization boundary
- agent-facing game instructions/skill

Acceptance:

- an agent can play a full seat without receiving hidden hands
- model selects server-generated move IDs
- invalid/stale tool calls cannot mutate state

## Phase 9 — Additional adapters

Order:

1. Cursor
2. Codex
3. DSH
4. other coding agents based on demand

Each adapter must map into protocol v1 and preserve the fail-open/privacy invariants.

## Phase 10 — Packaging and install UX

Deliverables:

- `waitloop` CLI or equivalent installer
- detect supported agents
- install/update/uninstall adapters safely
- local pairing flow
- clear diagnostic/status command

Target UX:

```text
$ waitloop init

detecting agents...
✓ Claude Code
✓ Codex
✓ Cursor

install integrations? [Y/n]
```

## Later — Arena

Agent-vs-agent is an experiment layer, not a v0.1 dependency.

Potential work:

- deterministic match runner
- model/agent adapters
- replay logs containing public decisions only by default
- metrics such as win rate and tool-call errors
- reproducible seeds/configurations

Do not let benchmark features complicate the human waiting experience.
