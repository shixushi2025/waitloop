# Current implementation status

This document is a compact handoff snapshot of `main`. It describes what is true **now**, not the history of how Waitloop reached this state.

For subsystem details, follow [`README.md`](README.md) in this directory.

## Deployment

- Production domain: `https://waitloop.run`.
- Cloudflare Worker + Static Assets + Durable Objects.
- GitHub pushes to `main` are configured to deploy through Cloudflare.
- CI still runs a Wrangler deployment dry-run before merge.

## Agent lifecycle

Canonical lifecycle states:

```text
idle | running | waiting | completed | failed
```

Available lifecycle adapters:

```text
Claude Code   available
Cursor        available
Codex         available
DSH           planned
```

Lifecycle delivery is fail-open and deliberately excludes prompts, source code, repository paths, terminal/tool output, transcripts, assistant output, and native agent session identifiers.

Runtime components:

- `AgentSession` Durable Object;
- `DeviceRegistry` Durable Object;
- `PairingRequest` Durable Object;
- scoped `wldev_...` device credentials;
- short-lived browser pairing with explicit approval.

## CLI

The public package is:

```text
@waitloop/cli
```

Install the current alpha channel with:

```bash
npm install -g @waitloop/cli@alpha
```

Supported commands include:

```text
init
pair / unpair
doctor
install / uninstall
status
open
config
join
hook
```

`waitloop join <code>` exchanges a one-time connected-agent room code for a temporary room-scoped MCP credential. Exact package version/capability metadata is authoritative in `packages/cli/package.json` and `apps/web/public/agent.json`.

CLI publication uses npm Trusted Publishing / GitHub Actions OIDC. Normal publishing must not depend on a long-lived npm publish token.

## Public Agent discovery

Stable public surfaces:

```text
https://waitloop.run/agent.md
https://waitloop.run/agent.json
https://waitloop.run/llms.txt
https://waitloop.run/skills/waitloop/SKILL.md
https://waitloop.run/mcp
```

Room-specific onboarding:

```text
https://waitloop.run/join/<join-code>
```

`agent.md` is universal product/integration guidance. `/join/<code>` is temporary room-specific onboarding. `agent.json` is the machine-readable capability manifest.

## Game runtime

Participant types:

```text
Human
Bot
Hosted Agent
Connected Agent
```

Current Dou Dizhu table modes:

```text
you + 2 bots
you + configured hosted agent + bot
you + connected agent + bot
```

The game is server-authoritative and hidden-information safe:

- rules live in `packages/doudizhu`;
- generic room logic lives outside the Dou Dizhu package;
- browser humans do not receive exhaustive `legalMoves[]`;
- hosted/MCP agents select server-generated move IDs;
- stale and out-of-turn mutations are rejected;
- browser lobby projection does not expose dealt hands or landlord assignment before a connected-agent seat is ready.

Current pre-bidding Dou Dizhu behavior:

- standard 54-card deck;
- landlord is chosen randomly from all three seats when the table is prepared;
- landlord receives the three bottom cards and leads;
- full bidding/scoring is not implemented yet.

## Connected-agent room flow

Connected-agent tables use a lobby phase:

```text
room created
  -> waiting_for_players
  -> join code claimed
  -> seat connecting
  -> first authenticated MCP request
  -> seat connected
  -> playing
```

Two connection paths are first-class:

```text
waitloop join <code>
raw room-scoped MCP configuration
```

MCP tools remain deliberately small:

```text
get_turn()
play_move(expectedRevision, moveId)
```

Casual connected-agent tables have no hard turn timeout. The UI shows elapsed waiting/thinking time and can warn that an agent is taking longer than usual, but does not force a move.

## Hosted agents

The Worker can expose hosted DeepSeek and OpenAI players when the relevant secrets are configured.

Hosted agents receive only their viewer-specific game state and server-generated legal moves. Provider failures, invalid selections, or infrastructure timeouts fall back to a deterministic legal move so a hosted request does not permanently block the room.

## Web game experience

The current Dou Dizhu UI is developer-native and includes:

- explicit authoritative `TURN` state;
- current trick;
- recent activity history;
- short presentation pacing for automated actions without sleeping in game/Worker logic;
- clickable card selection plus play/pass/hint/clear;
- soft elapsed time for connected agents;
- linked coding-agent interruption/pause behavior;
- connected-agent lobby with CLI join, raw MCP, and `/agent.md` help paths.

## Validation required on main

CI currently validates:

```text
frozen pnpm install
root + CLI TypeScript
Vitest suite
repository contract / docs-Agent synchronization
CLI npm tarball and packaged --version
browser JavaScript syntax
public Agent discovery files
Wrangler deployment dry-run
```

## Known gaps

These are current gaps, not historical TODOs:

- full Dou Dizhu bidding / rob-landlord / scoring;
- stronger reconnect and disconnected-seat recovery UX;
- explicit user-controlled replace-with-bot takeover for a stalled/disconnected connected agent;
- room/join/credential expiry cleanup beyond current join-code expiry behavior;
- rate limiting and abuse controls for public room creation, pairing, MCP, lifecycle ingest, and hosted inference;
- hosted-agent cost budgets/quotas before broad public usage;
- stronger production CSP/CORS/security hardening;
- account-backed browser lifecycle-session access/device-management UX if/when accounts are introduced;
- DSH lifecycle adapter;
- Arena/benchmark mode.

Forward priorities live in [`roadmap.md`](roadmap.md).