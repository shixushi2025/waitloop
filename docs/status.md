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

- pnpm TypeScript monorepo with committed `pnpm-lock.yaml`
- strict TypeScript including `exactOptionalPropertyTypes`
- Vitest test suite
- Cloudflare Worker + static assets
- GitHub Actions CI with frozen-lockfile install
- root and CLI TypeScript typecheck
- full Vitest suite
- browser JavaScript syntax validation
- Agent discovery / `agent.json` validation
- CLI tarball validation through `npm pack --dry-run --json`
- packaged `waitloop --version` execution check
- `wrangler deploy --dry-run` Worker/config validation

### Agent discovery

Public machine-facing discovery:

```text
https://waitloop.run/agent.md
https://waitloop.run/agent.json
https://waitloop.run/llms.txt
https://waitloop.run/skills/waitloop/SKILL.md
```

- `/agent.md` is the stable universal installation/integration guide
- `/agent.json` is the machine-readable capability/install manifest
- `/llms.txt` points general LLM discovery at canonical resources
- Waitloop skill is credential-free
- CLI, lifecycle hooks, Skill, and game MCP are explicitly separate layers
- Claude Code, Cursor, and Codex lifecycle support is available; DSH lifecycle remains planned
- room-specific `/join/<code>` instructions are intentionally separate from `/agent.md`

### Agent lifecycle

- canonical v1 agent event parser
- unknown-field rejection at ingest
- duplicate/stale/terminal transition reducer
- AgentSession Durable Object
- real-time AgentSession WebSocket snapshots
- Claude Code, Cursor, and Codex lifecycle adapters
- shared local lifecycle state layer
- native harness session identifiers remain local
- lifecycle delivery is best-effort/fail-open with bounded timeout

### Waitloop CLI

Current public alpha:

```text
@waitloop/cli@0.1.0-alpha.3
```

Implemented commands include:

```text
waitloop init
waitloop pair
waitloop join WL-XXXXXXXXXX
waitloop unpair
waitloop doctor
waitloop install/uninstall <claude-code|cursor|codex|all>
waitloop status
waitloop open
waitloop config
waitloop hook <claude-code|cursor|codex>
```

- local config under `~/.waitloop/config.json`
- stable opaque local device ID
- browser-based device pairing
- safe hook install/uninstall for Claude Code, Cursor, Codex
- Codex hook trust reminder
- redacted config display
- `waitloop join` exchanges a one-time room join code for a room-scoped MCP credential
- join credentials are cached privately under `~/.waitloop/joins` so an interrupted local setup can retry without re-claiming the code
- `waitloop join --json` provides machine-readable MCP configuration

### CLI npm publishing

- canonical package: `@waitloop/cli`
- public alpha dist-tag: `alpha`
- current version: `0.1.0-alpha.3`
- npm Trusted Publishing / GitHub Actions OIDC is verified in production
- publish workflow uses Node 24/npm 11 and `id-token: write`
- releases are tokenless; no npm publish token is required by the workflow
- npm provenance is enabled for publication
- package contents are limited to built `dist/`, README, LICENSE, and npm-required metadata
- `waitloop --version` is derived from package metadata rather than separately hard-coded

See [`cli-release.md`](cli-release.md).

### Device credentials and browser pairing

- DeviceRegistry Durable Object
- PairingRequest Durable Object
- opaque `wldev_...` device credentials
- SHA-256 credential digests stored server-side
- one current credential per device ID; replacement rotates prior credential
- first scope: `agent:write`
- short-lived browser pairing requests
- locally generated verifier, server stores only verifier digest before exchange
- pairing URL contains no final device credential
- explicit browser approval at `/pair/<pairingId>`
- one-time exchange
- `DELETE /api/v1/devices/current` self-revocation
- privileged bootstrap remains only as development/recovery fallback

### Player model

```text
Human
Bot
Hosted Agent
Connected Agent
```

- Bot = deterministic server rule player; no LLM call
- Hosted Agent = model call executed by Waitloop Worker
- Connected Agent = external MCP-controlled seat
- participant metadata is attached to room snapshots for unambiguous UI labels

### Hosted game agents

- DeepSeek and OpenAI provider support
- `GET /api/v1/hosted-agents` lists only configured providers
- provider keys remain Worker secrets
- only the hosted seat's visible game state plus legal move IDs are sent to the model
- model selects only a server-generated `moveId`
- invalid/error/transport-timeout responses fall back to a deterministic legal move
- per-seat runtime stats track calls, token counts, latency, fallback count, and last error

See [`hosted-agents.md`](hosted-agents.md).

### Browser room authorization

- public browser room creation does not require `WAITLOOP_ACCESS_TOKEN`
- room creation issues a high-entropy `wlview_...` viewer credential
- raw viewer credential stays in a room-scoped HttpOnly cookie
- only credential digest is persisted in GameRoom
- room IDs are identifiers, not authorization credentials
- browser snapshot/play/pass/hint/pause/resume APIs validate the viewer credential
- cookies use `SameSite=Strict`, room-specific paths, and `Secure` on HTTPS

### Human vs Agent game protocol

Human browser flow:

```text
human-safe snapshot
        ↓
select card IDs
        ↓
/play, /pass, /hint
        ↓
server resolves selection against authoritative legal moves
```

Machine flow:

```text
get_turn()
        ↓
server-generated legalMoves[]
        ↓
play_move(expectedRevision, moveId)
```

- human browser snapshots omit exhaustive `legalMoves[]`
- human controls expose only small capabilities such as `canPass` / `canHint`
- hosted/MCP agents retain move-ID selection
- lobby human projections expose no dealt hand or landlord assignment before the connected seat is ready

### Game core

- game-agnostic room contracts
- revision / stale-command protection
- pause/resume behavior
- viewer-specific snapshots
- game rules remain outside the generic room layer

### Dou Dizhu

- canonical 54-card deck
- deterministic injected-deck tests
- pattern classification/comparison
- singles, pairs, triples and attachments
- straights and consecutive pairs
- airplanes with documented attachment behavior
- four-with-two variants
- bombs and rocket
- legal move generation
- turn/pass/trick reset state machine
- viewer-specific private hand projection
- deterministic full-game simulation test
- current pre-bidding alpha chooses landlord randomly from all three seats instead of hard-coding the human

Full bidding and scoring are not implemented yet.

### Game Experience v2

Connected-agent room runtime adds a presentation/lobby phase outside the game rules layer:

```text
waiting_for_players -> playing -> paused -> playing -> finished
```

Seat runtime states:

```text
ready | waiting | connecting | connected
```

Implemented behavior:

- connected-agent rooms start in a lobby
- human, bot, and hosted seats are ready immediately
- connected-agent seat begins `waiting`
- one-time join-code claim changes it to `connecting`
- first authenticated MCP request changes it to `connected` and starts the game
- browser waiting projection does not expose cards or landlord
- random landlord becomes visible only once the game is active
- `>` is the authoritative current TURN marker
- UI separates `current_trick/` from recent `activity/`
- browser reconstructs a short opponent-action presentation queue from authoritative history; Worker/game logic does not sleep for animation
- connected-agent turns show elapsed thinking time
- casual tables have no hard move deadline and do not auto-pass merely because an agent is slow

See [`game-experience-v2.md`](game-experience-v2.md).

### Room-specific join flow

Connected-agent rooms generate a high-entropy human-readable join code:

```text
WL-XXXXXXXXXX
```

- room ID is derived from a one-way hash and does not embed the join code
- join code has a bounded lifetime
- join code can issue one MCP seat credential only
- preferred path: `waitloop join <code>`
- alternative path: raw MCP claim for agents without the CLI
- browser/agent onboarding URL: `/join/<code>`
- browser requests to `/join/<code>` receive a dedicated join page
- non-browser requests can receive room-specific Markdown instructions
- `/agent.md` remains stable universal guidance

### MCP

- remote `/mcp` based on the MCP TypeScript server SDK
- room/seat-scoped bearer authentication
- room binding is outside model-visible tool arguments
- `get_turn()`
- `play_move(expectedRevision, moveId)`
- seat tokens are hashed before persistence
- room creation no longer exposes the raw seat token
- join claim issues the temporary seat credential
- first authenticated MCP request is the connected seat readiness signal

## Refactoring completed with Game Experience v2

The main growth hotspot in `worker/src/index.ts` was split by responsibility:

- shared HTTP helpers moved to `worker/src/http.ts`
- room/join HTTP behavior moved to `worker/src/room-api.ts`
- join-code capability logic moved to `worker/src/room-code.ts`
- room/seat runtime stays in `GameRoom`
- presentation-history helpers moved out of the browser entry script

The current boundary is intentionally moderate. `GameRoom` and the browser game controller remain cohesive runtime coordinators; they should be split further only when additional lifecycle/reconnect/game modes create stable new responsibilities. Avoid splitting them into many tiny files solely to reduce line counts.

## Validation performed

Game Experience v2 passed on a GitHub-hosted runner before merge:

- frozen-lockfile install
- root TypeScript typecheck
- CLI TypeScript typecheck
- full Vitest suite including join-code and lobby privacy regressions
- CLI npm tarball validation
- built CLI version/shebang validation
- browser JavaScript syntax validation
- Agent discovery/manifest validation
- Wrangler deployment dry-run

`@waitloop/cli@0.1.0-alpha.3` was then published through npm Trusted Publishing/OIDC and registry verification succeeded.

## Still required before a public beta

- production verification of the new Game Experience v2 flow after Cloudflare deployment
- rate limiting / abuse controls for public pairing, join claims, room creation, hosted inference, and lifecycle ingestion
- room/join lifecycle expiry and storage cleanup
- automatic harness-specific temporary MCP installation/removal after `waitloop join` where the harness offers a stable supported mechanism
- connected-agent reconnect/last-seen UX and optional manual bot takeover
- optional account-backed device list/revoke/rotation UX
- authenticated browser session/ticket flow for private coding-agent lifecycle sessions
- production CSP/CORS/auth hardening
- hosted-agent cost budgets/quotas before broad public use
- game-state persistence migration tests
- full Dou Dizhu bidding and scoring
- DSH adapter once its lifecycle integration contract is fixed

## Next implementation order

1. Deploy and verify Game Experience v2 on the production Worker/static assets.
2. Add rate limits and room/join expiry cleanup before wider public exposure.
3. Add connected-agent last-seen/reconnect and explicit `replace with bot` control without introducing a hard casual timeout.
4. Improve `waitloop join` with harness-specific temporary MCP install/remove where stable APIs exist; keep raw MCP first-class.
5. Add browser access for linked coding-agent lifecycle sessions without a Worker-wide token.
6. Add full Dou Dizhu bidding/scoring once the end-to-end room experience is stable.
7. Add DSH lifecycle support once its integration contract is fixed.
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
