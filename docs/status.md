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
- Claude Code lifecycle adapter
- Cursor lifecycle adapter
- shared local lifecycle state layer for adapters
- native Claude/Cursor session identifiers stay local and are hashed only for local temporary filenames

### Waitloop CLI

- local `~/.waitloop/config.json`
- stable opaque local device ID (metadata only; not authentication)
- agent detection for Claude Code, Cursor, Codex, and DSH
- `waitloop init`
- `waitloop doctor`
- `waitloop install/uninstall claude-code`
- `waitloop install/uninstall cursor`
- `waitloop install/uninstall all`
- `waitloop status`
- `waitloop open`
- redacted `waitloop config`
- lifecycle hook delivery is best-effort/fail-open with a bounded timeout
- hook installers merge safely and uninstall only Waitloop-owned handlers

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
- simple server-side bot seats
- WebSocket room snapshots
- terminal/IDE-like Dou Dizhu web UI
- `you + 2 bots` room mode
- `you + agent + bot` room mode
- one-time MCP seat setup output for the agent room
- linked coding-agent state can pause the game UI/runtime

### MCP

- remote `/mcp` boundary using the v2 MCP TypeScript server SDK
- seat-scoped bearer authentication
- room binding outside the model-visible tool arguments
- `get_turn()`
- `play_move(expectedRevision, moveId)`
- seat tokens hashed before Durable Object persistence
- agent seat token is returned only when the room is created and is not placed in the room URL

## Validation performed so far

The CLI source has been checked with strict TypeScript options including `exactOptionalPropertyTypes`. Synthetic local hook tests have exercised Claude Code and Cursor lifecycle delivery against a local HTTP receiver. Those checks confirmed that injected prompt text, repository paths, tool/output text, and native agent session IDs were not present in emitted Waitloop events.

This is not a substitute for a clean repository-wide CI run with the final lockfile.

## Still required before a public beta

- clean CI confirmation on the complete dependency graph and a committed lockfile
- real device/account pairing instead of alpha bearer tokens
- authenticated browser WebSocket flow
- room lifecycle/expiry cleanup
- rate limiting
- production CSP/CORS/auth hardening
- game state persistence migration tests
- full Dou Dizhu bidding and scoring
- robust reconnect/recovery UX
- publish/install/update flow for the CLI package
- Codex adapter
- DSH adapter
- dynamic MCP setup without copying room JSON by hand

## Next implementation order

1. Validate/fix the current workspace in CI and commit a lockfile.
2. Implement real device/account pairing so local agents no longer need Worker-wide alpha secrets.
3. Finish Claude Code/Cursor setup so lifecycle hooks and the current game seat can be connected without copying JSON by hand.
4. Add Codex adapter.
5. Add DSH adapter.
6. Deploy the first authenticated Cloudflare preview.
7. Add full Dou Dizhu bidding/scoring after the end-to-end waiting loop is stable.
8. Only then add more games and Arena experiments.

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
