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
- committed `pnpm-lock.yaml`
- strict TypeScript configuration
- Vitest configuration
- Cloudflare Worker/static-assets setup
- GitHub Actions workflow
- pnpm dependency cache keyed by the committed lockfile
- CI uses `pnpm install --frozen-lockfile`
- CI runs root TypeScript typecheck
- CI runs CLI TypeScript typecheck
- CI runs the full Vitest suite
- CI runs `wrangler deploy --dry-run --outdir .wrangler-dist` so Worker bundling/configuration and Durable Object exports are checked before Cloudflare deployment

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
- stable opaque local device ID
- agent detection for Claude Code, Cursor, Codex, and DSH
- `waitloop init`
- `waitloop pair`
- `waitloop pair --no-open`
- `waitloop pair --bootstrap-token ...` development fallback
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

### Device credentials and browser pairing

- DeviceRegistry Durable Object
- PairingRequest Durable Object
- PairingRequest is exported from the Worker entrypoint and declared in Wrangler configuration
- opaque `wldev_...` device credentials
- raw device credentials are returned only at issuance
- only SHA-256 credential digests are stored server-side
- one current credential per device ID; issuing a replacement rotates the old credential
- first scope: `agent:write`
- short-lived five-minute pairing requests
- CLI generates a high-entropy verifier locally and sends only its SHA-256 digest when creating a request
- pairing URL contains only a high-entropy pairing ID, never the verifier or final device credential
- browser approval page at `/pair/<pairingId>`
- explicit browser approval action
- CLI polls the exchange endpoint and sends the raw verifier only in the exchange request body
- pairing exchange is one-time-use
- successful exchange issues one scoped device credential and stores it privately in local config
- `waitloop pair` opens the browser automatically unless `--no-open` is used
- `DELETE /api/v1/devices/current` supports self-revocation
- `waitloop unpair` self-revokes before removing the local credential
- `/api/v1/agent-events` accepts the scoped device credential while retaining the legacy ingest token only as a migration path
- privileged `/api/v1/devices/bootstrap` remains as a development/recovery fallback

The current browser approval model is intentionally account-optional. Possession of the high-entropy pairing URL is the approval capability for this alpha. A future account layer can require authentication before `approve` without changing the CLI verifier/device-credential protocol.

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

Temporary validation PRs are used only when a `pull_request` trigger is needed to inspect the exact GitHub Actions job. They are closed without merge; validation-only files never reach `main`.

The current dependency graph has passed:

- frozen-lockfile installation
- pnpm cache restore
- root TypeScript typecheck
- CLI TypeScript typecheck
- the full Vitest suite (43 tests at the latest validation)
- Wrangler deploy dry-run bundling/configuration validation

The Wrangler dry-run was added after Cloudflare correctly detected a configured `PairingRequest` Durable Object that had not yet been exported from `worker/src/index.ts`. The entrypoint/export mismatch was fixed and is now covered by CI.

Synthetic lifecycle tests have also exercised Claude Code, Cursor, and Codex adapters against a local HTTP receiver. Those checks confirmed that injected prompt text, repository paths, tool/output text, transcript paths, and native agent session/turn identifiers were not present in emitted Waitloop events.

## Still required before a public beta

- rate limiting / abuse controls for public pairing creation and lifecycle ingestion
- optional account-backed device list/revoke/rotation UX
- authenticated browser session/ticket flow for private agent sessions, rooms, and WebSockets; long-lived device bearer tokens must not be put into browser URLs
- dynamic MCP seat setup without copying room JSON by hand
- room lifecycle/expiry cleanup
- production CSP/CORS/auth hardening
- game state persistence migration tests
- full Dou Dizhu bidding and scoring
- robust reconnect/recovery UX
- publish/install/update flow for the CLI package
- DSH adapter once its lifecycle integration contract is fixed

## Next implementation order

1. Replace the current private browser token boundary with a browser session/ticket model for sessions, rooms, and WebSockets.
2. Connect the current game seat/MCP setup to the installed local agent without copying JSON by hand.
3. Add rate limiting and pairing/lifecycle abuse controls before opening the service broadly.
4. Add the DSH adapter once its lifecycle contract is fixed.
5. Deploy and harden the first Cloudflare preview.
6. Add full Dou Dizhu bidding/scoring after the end-to-end waiting loop is stable.
7. Only then add more games and Arena experiments.

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
