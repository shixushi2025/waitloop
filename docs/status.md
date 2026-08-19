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
- CI runs `wrangler deploy --dry-run --outdir .wrangler-dist`

### Agent lifecycle

- canonical v1 agent event parser
- unknown-field rejection at ingest
- duplicate/stale/terminal transition reducer
- AgentSession Durable Object
- real-time AgentSession WebSocket snapshots
- Claude Code lifecycle adapter
- Cursor lifecycle adapter
- Codex lifecycle adapter
- shared local lifecycle state layer for adapters
- native Claude/Cursor/Codex session identifiers stay local and are hashed only for temporary local filenames

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
- privileged `/api/v1/devices/bootstrap` remains as a development/recovery fallback

The current browser approval model is account-optional. A future account layer can require authentication before approval without changing the CLI verifier/device-credential protocol.

### Player model

The game runtime now distinguishes four participant types:

```text
Human
Bot
Hosted Agent
Connected Agent
```

- bots are zero-cost deterministic rule players;
- hosted agents are server-side model calls such as DeepSeek or GPT;
- connected agents are external MCP-controlled seats such as Codex, Claude Code, Cursor, or DSH.

Participant metadata is attached to room snapshots so the UI can display the actual player type/name instead of an ambiguous generic `agent` label.

### Hosted game agents

- server-side Hosted Agent runner
- DeepSeek provider support
- OpenAI provider support
- `GET /api/v1/hosted-agents` returns only providers configured on the deployment
- default DeepSeek model: `deepseek-v4-flash`
- default OpenAI model: `gpt-5.6`
- model names are overrideable with Worker variables
- provider API keys remain Worker secrets and are never exposed to the browser
- only that seat's visible game state plus legal move IDs are sent to the provider
- model output is restricted to selecting a server-generated `moveId`
- invalid/model-error/timeout responses fall back to a deterministic legal move instead of blocking the room
- per-hosted-seat runtime statistics track calls, input/output tokens, latency, fallback count, and last error

See [`hosted-agents.md`](hosted-agents.md).

### Browser game room authorization

- public browser room creation no longer requires `WAITLOOP_ACCESS_TOKEN`
- room creation issues a high-entropy `wlview_...` viewer credential
- raw viewer credential is stored in a room-scoped HttpOnly cookie
- only the viewer credential digest is persisted in the GameRoom Durable Object
- room IDs may appear in URLs but are not authorization credentials
- snapshot/move/pause/resume APIs validate the room viewer credential
- browser WebSocket upgrades use the same HttpOnly room credential
- cookies use `SameSite=Strict`, room-specific paths, and `Secure` on HTTPS deployments
- legacy private-access paths remain available for development/admin compatibility

This replaces the previous public `create failed` behavior caused by protecting all room APIs with the Worker-wide private access token.

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
- authoritative move application
- WebSocket room snapshots
- terminal/IDE-like Dou Dizhu web UI
- visible create errors instead of only a `create failed` header
- `you + 2 bots`
- `you + hosted AI + bot` for every configured hosted provider
- `you + connected agent + bot`
- dynamic Hosted Agent buttons based on server configuration
- one-time MCP seat setup output for connected-agent rooms
- linked coding-agent state can pause the game UI/runtime

### MCP

- remote `/mcp` boundary using the v2 MCP TypeScript server SDK
- seat-scoped bearer authentication
- room binding outside the model-visible tool arguments
- `get_turn()`
- `play_move(expectedRevision, moveId)`
- seat tokens hashed before Durable Object persistence
- connected-agent seat token is returned only when the room is created and is not placed in the room URL

## Validation performed

Temporary validation PRs are used only when a `pull_request` trigger is needed to inspect exact GitHub Actions jobs. They are closed without merge; validation-only files never reach `main`.

The current hosted-agent/public-room revision passed:

- frozen-lockfile installation
- pnpm cache restore
- root TypeScript typecheck
- CLI TypeScript typecheck
- full Vitest suite
- Wrangler deploy dry-run bundling/configuration validation

Synthetic lifecycle tests have also exercised Claude Code, Cursor, and Codex adapters against a local HTTP receiver and confirmed that prompt text, repository paths, tool/output text, transcript paths, and native agent session/turn identifiers were not present in emitted lifecycle events.

## Still required before a public beta

- rate limiting / abuse controls for public pairing, room creation, hosted inference, and lifecycle ingestion
- optional account-backed device list/revoke/rotation UX
- authenticated browser session/ticket flow for private coding-agent lifecycle sessions; room access itself now uses scoped room credentials
- dynamic MCP seat setup without copying room JSON by hand
- room lifecycle/expiry cleanup
- production CSP/CORS/auth hardening
- hosted-agent cost budgets/quotas before broad public use
- game state persistence migration tests
- full Dou Dizhu bidding and scoring
- robust reconnect/recovery UX
- publish/install/update flow for the CLI package
- DSH adapter once its lifecycle integration contract is fixed

## Next implementation order

1. Verify the new public room flow on the deployed Cloudflare Worker and configure at least one Hosted Agent secret.
2. Connect the current MCP game seat to an installed local agent without copying JSON by hand.
3. Add rate limiting, hosted-agent budgets, and room expiry before broad public exposure.
4. Add browser access for linked coding-agent lifecycle sessions without a Worker-wide token.
5. Add the DSH adapter once its lifecycle contract is fixed.
6. Add full Dou Dizhu bidding/scoring after the end-to-end waiting loop is stable.
7. Add Agent Arena/private matches before online matchmaking.

## v0.1 acceptance target

```text
coding agent starts
        ↓
Waitloop reports running
        ↓
user opens a public game room
        ↓
user plays against bots / hosted AI / a connected agent
        ↓
agent needs attention or completes
        ↓
game pauses
        ↓
work becomes primary again
```
