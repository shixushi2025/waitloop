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
- CI validates browser JavaScript syntax
- CI validates public Agent discovery files and `agent.json`
- CI validates the final CLI npm tarball with `npm pack --dry-run --json`
- CI executes the packaged CLI and verifies `waitloop --version`
- CI runs `wrangler deploy --dry-run --outdir .wrangler-dist`

### Agent discovery

Public machine-facing discovery is implemented:

```text
https://waitloop.run/agent.md
https://waitloop.run/agent.json
https://waitloop.run/llms.txt
https://waitloop.run/skills/waitloop/SKILL.md
```

- `/agent.md` is the canonical installation/integration guide for AI agents
- `/agent.json` is the machine-readable capability/install manifest
- `/llms.txt` points general LLM discovery at the canonical resources
- the Waitloop skill is credential-free
- the guide distinguishes CLI, lifecycle hooks, Skill, and room-scoped game MCP instead of conflating them
- Claude Code, Cursor, and Codex lifecycle support is marked available; DSH lifecycle support remains planned
- installer agents are instructed not to invent unpublished packages or unsupported adapter paths

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

### CLI npm release preparation

The CLI is release-ready but has not yet been claimed as publicly published in the Agent manifest.

- canonical npm package: `@waitloop/cli`
- first release candidate: `0.1.0-alpha.1`
- prerelease install command once published: `npm install -g @waitloop/cli@alpha`
- package includes only built `dist/`, package README, LICENSE, and npm-required metadata
- package version is read at runtime by `waitloop --version`; it is not separately hard-coded in the CLI entrypoint
- `agent.json` package name/version/dist-tag/install command are checked against `package.json`
- `.github/workflows/publish-cli.yml` publishes GitHub Releases tagged `cli-v<version>`
- publish workflow uses Node 24/npm 11 and grants OIDC `id-token: write`
- publish workflow supports a temporary `NPM_TOKEN` only for first-publication bootstrap
- subsequent releases are designed for npm Trusted Publishing/OIDC with provenance
- detailed procedure: [`cli-release.md`](cli-release.md)

`apps/web/public/agent.json` intentionally keeps `cli.published: false` until the first npm publish has actually succeeded. After that one-time verification it should be flipped to `true` so automated installer agents prefer npm over the source fallback.

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

The game runtime distinguishes four participant types:

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
- browser snapshot/play/pass/hint/pause/resume APIs validate the room viewer credential
- cookies use `SameSite=Strict`, room-specific paths, and `Secure` on HTTPS deployments
- legacy private-access paths remain available for development/admin compatibility

### Human vs Agent game protocol

Human and machine players no longer use the same interaction payload.

Human browser flow:

```text
human-safe snapshot (no exhaustive legalMoves)
        ↓
select card IDs
        ↓
/play, /pass, or /hint
        ↓
server resolves/validates against authoritative legal moves
```

Agent flow:

```text
get_turn()
        ↓
server-generated legalMoves[]
        ↓
play_move(expectedRevision, moveId)
```

- Human snapshots omit exhaustive `legalMoves[]`
- Human snapshots expose only small controls such as `canPass` / `canHint`
- `/play` accepts selected card IDs and resolves them server-side to a legal authoritative move
- `/hint` returns one card selection at a time rather than enumerating all moves in the UI
- Hosted Agent and MCP Agent paths retain move-ID selection
- the human web UI uses direct operation responses and light polling while waiting for a connected external agent, so machine snapshots are not leaked back into the browser UI path

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
- terminal/IDE-like Dou Dizhu web UI
- visible create errors instead of only a `create failed` header
- human card selection with `play / pass / hint / clear`
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

The current revision has passed on a GitHub-hosted runner:

- frozen-lockfile installation
- pnpm cache restore
- root TypeScript typecheck
- CLI TypeScript typecheck
- full Vitest suite
- CLI `npm pack --dry-run --json`
- packed-file allowlist checks
- built CLI shebang check
- packaged `waitloop --version` check
- browser JavaScript syntax validation
- Agent discovery/manifest validation
- Wrangler deploy dry-run bundling/configuration validation

Synthetic lifecycle tests have also exercised Claude Code, Cursor, and Codex adapters against a local HTTP receiver and confirmed that prompt text, repository paths, tool/output text, transcript paths, and native agent session/turn identifiers were not present in emitted lifecycle events.

## Still required before a public beta

- perform and verify the one-time first npm publication of `@waitloop/cli`
- configure npm Trusted Publishing for `publish-cli.yml`, then remove the bootstrap token
- flip `agent.json.cli.published` to `true` only after the npm package is verified
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
- DSH adapter once its lifecycle integration contract is fixed

## Next implementation order

1. Bootstrap the first npm publication and switch subsequent CLI releases to npm Trusted Publishing/OIDC.
2. Verify the current public game and `/agent.md` flows on the deployed Cloudflare Worker.
3. Connect the current MCP game seat to an installed local agent without copying JSON by hand.
4. Add rate limiting, hosted-agent budgets, and room expiry before broad public exposure.
5. Add browser access for linked coding-agent lifecycle sessions without a Worker-wide token.
6. Add the DSH adapter once its lifecycle contract is fixed.
7. Add full Dou Dizhu bidding/scoring after the end-to-end waiting loop is stable.
8. Add Agent Arena/private matches before online matchmaking.

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
