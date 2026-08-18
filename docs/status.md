# Implementation status

This file records what is actually implemented on `main`. It is intentionally narrower than the roadmap.

## Implemented

### Product and engineering contract

- product definition and non-goals
- Cloudflare Worker + Durable Object architecture
- canonical lifecycle protocol
- privacy/security invariants
- game-system boundary
- developer-native design language
- coding-agent repository instructions in `AGENTS.md`

### Workspace

- pnpm TypeScript monorepo
- strict TypeScript configuration
- Vitest configuration
- Cloudflare Worker/static-assets setup
- GitHub Actions typecheck/test workflow

### Agent lifecycle

- canonical v1 agent event parser
- unknown-field rejection at ingest
- duplicate/stale/terminal transition reducer
- AgentSession Durable Object
- real-time AgentSession WebSocket snapshots
- minimal waiting status UI
- first Claude Code hook adapter

### Game core

- game-agnostic room contracts
- room revision / stale-command checks
- pause/resume behavior
- viewer-specific snapshot contract

### Dou Dizhu

- canonical 54-card deck
- deterministic injected-deck testing
- pattern classification and comparison
- singles, pairs, triples and attachments
- straights and consecutive pairs
- airplanes with documented attachment behavior
- four-with-two variants
- bombs and rocket
- legal move generation
- turn/pass/trick reset state machine
- explicit viewer-specific private hand projection
- deterministic full-game simulation test

The alpha currently assigns the landlord explicitly when creating a room. A full bidding/scoring phase is not implemented yet.

### Game runtime and UI

- GameRoom Durable Object
- generic game registry boundary
- local-alpha room creation API
- authoritative move application
- two simple server-side bot seats
- WebSocket room snapshots
- terminal/IDE-like Dou Dizhu web UI
- linked agent state can pause the game UI/runtime

### MCP

- remote `/mcp` boundary using the v2 MCP TypeScript server SDK
- seat-scoped bearer authentication
- room binding outside the model-visible tool arguments
- `get_turn()`
- `play_move(expectedRevision, moveId)`
- seat tokens hashed before Durable Object persistence

## Still required before a public beta

- clean CI confirmation on the complete dependency graph and lockfile
- device/account pairing instead of alpha bearer tokens
- authenticated browser WebSocket flow
- room lifecycle/expiry cleanup
- rate limiting
- production CSP/CORS/auth hardening
- game state persistence migration tests
- full Dou Dizhu bidding, scoring, and rule-profile documentation
- robust reconnect/recovery UX
- install/update/uninstall CLI

## Next implementation order

1. Validate/fix the current workspace in CI.
2. Add a human + agent + bot room creation UX and MCP setup output.
3. Finish the Claude Code integration around that setup flow.
4. Add Cursor adapter.
5. Add Codex adapter.
6. Add DSH adapter.
7. Deploy the first Cloudflare preview.
8. Only after the waiting loop is solid, add more games and Arena experiments.

## v0.1 acceptance target

The first real release is not defined by the number of games. It is defined by one uninterrupted workflow:

```text
coding agent starts
        ↓
Waitloop reports running
        ↓
user enters a small game
        ↓
agent needs attention or completes
        ↓
game pauses immediately
        ↓
work becomes the primary action again
```

For agent participation, the parallel acceptance path is:

```text
create a room with one agent seat
        ↓
configure the seat-scoped MCP connection
        ↓
agent calls get_turn
        ↓
agent chooses a returned moveId
        ↓
agent calls play_move
        ↓
hidden hands remain inaccessible
```
