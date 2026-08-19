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

### Workspace and validation

- pnpm TypeScript monorepo
- strict TypeScript configuration
- Vitest configuration
- Cloudflare Worker/static-assets setup
- GitHub Actions typecheck/test workflow
- a real GitHub Actions validation run has completed successfully with:
  - dependency installation
  - root TypeScript typecheck
  - CLI TypeScript typecheck
  - full Vitest suite

The repository still needs a committed `pnpm-lock.yaml`; CI currently installs with `--no-frozen-lockfile` and intentionally does not enable pnpm cache until the lockfile is committed.

### Agent lifecycle

- canonical v1 agent event parser
- unknown-field rejection at ingest
- duplicate/stale/terminal transition reducer
- AgentSession Durable Object
- real-time AgentSession WebSocket snapshots
- minimal waiting status UI
- Claude Code lifecycle adapter
- Cursor lifecycle adapter
- Codex lifecycle adapter
- shared local lifecycle state layer for adapters
- native Claude/Cursor/Codex session identifiers stay local and are hashed only for local temporary filenames

### Waitloop CLI

- local `~/.waitloop/config.json`
- stable opaque local device ID (metadata only; not authentication)
- agent detection for Claude Code, Cursor, Codex, and DSH
- `waitloop init`
- `waitloop pair`
- `waitloop unpair`
- `waitloop doctor`
- install/uninstall for Claude Code, Cursor, and Codex
- `waitloop install/uninstall all`
- `waitloop status`
- `waitloop open`
- redacted `waitloop config`
- lifecycle hook delivery is best-effort/fail-open with a bounded timeout
- hook installers merge safely and uninstall only Waitloop-owned handlers
- Codex installer reminds the user to review/trust the non-managed command hook
- lifecycle delivery prefers a scoped device credential and retains the old Worker-wide ingest token only as a migration fallback

### Device credentials and alpha pairing

- DeviceRegistry Durable Object
- opaque `wldev_...` device credentials
- raw device credentials are returned only at issuance
- only SHA-256 credential digests are stored server-side
- one current credential per device ID; issuing a replacement rotates the old credential
- first scope: `agent:write`
- `POST /api/v1/devices/bootstrap` for the temporary alpha bootstrap flow
- `DELETE /api/v1/devices/current` for self-revocation
- `waitloop pair` stores the scoped device credential privately and removes the legacy lifecycle ingest token after successful migration
- `waitloop unpair` self-revokes before removing the local credential; network/server failures keep the local credential so revocation can be retried
- `/api/v1/agent-events` accepts the scoped device credential while retaining the legacy ingest token only as a migration path

This is the credential substrate for the final pairing experience. The public browser/account approval flow is not implemented yet; the current bootstrap endpoint deliberately requires privileged bootstrap authority outside localhost.

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

## Validation performed

A temporary validation PR was used only to trigger the repository's `pull_request` workflow. It was closed without merge after the CI job completed successfully. The validated dependency graph installed successfully and the root/CLI TypeScript checks plus the full Vitest suite passed.

Synthetic lifecycle tests have also exercised Claude Code, Cursor, and Codex adapters against a local HTTP receiver. Those checks confirmed that injected prompt text, repository paths, tool/output text, transcript paths, and native agent session/turn identifiers were not present in emitted Waitloop events.

## Still required before a public beta

- committed `pnpm-lock.yaml` and restoration of lockfile-based pnpm cache/frozen installs
- public browser/account approval pairing instead of the alpha bootstrap authority
- account device list/revoke/rotation UX
- authenticated browser session/WebSocket flow; long-lived device bearer tokens must not be put into browser URLs
- dynamic MCP seat setup without copying room JSON by hand
- room lifecycle/expiry cleanup
- rate limiting
- production CSP/CORS/auth hardening
- game state persistence migration tests
- full Dou Dizhu bidding and scoring
- robust reconnect/recovery UX
- publish/install/update flow for the CLI package
- DSH adapter once its lifecycle integration contract is fixed

## Next implementation order

1. Commit `pnpm-lock.yaml`, switch CI to frozen installs, and restore pnpm dependency caching.
2. Build the public short-lived pairing-request + browser/account approval flow on top of the existing DeviceRegistry credential model.
3. Replace the current private browser token boundary with an authenticated browser session/ticket model for sessions, rooms, and WebSockets.
4. Connect the current game seat/MCP setup to the installed local agent without copying JSON by hand.
5. Add the DSH adapter once its lifecycle contract is fixed.
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
connect the seat-scoped MCP capability to the intended local agent
        ↓
agent calls get_turn
        ↓
agent chooses a returned moveId
        ↓
agent calls play_move
        ↓
hidden hands remain inaccessible
```
