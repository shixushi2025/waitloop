# Current implementation status

This document is the compact handoff snapshot of current durable truth. Detailed subsystem contracts live in the canonical documents indexed by [`README.md`](README.md).

## Deployment and release

- Production: `https://waitloop.run`.
- Runtime: Cloudflare Worker, Static Assets, and Durable Objects.
- Production deployment is gated by the exact commit's GitHub Actions `ready-to-deploy` result.
- Manual production deployment is permitted only from a clean local `main` that matches the validated repository state.
- npm alpha channel:

```text
@waitloop/cli@alpha
0.1.0-alpha.9
```

Alpha.9 was published through npm Trusted Publishing. The exact version, `alpha` dist-tag, clean global installation, and packaged MCP stdio/MCP Apps behavior were independently verified before the annotated source tag `cli-v0.1.0-alpha.9` was recorded.

Install or update with:

```bash
npm install -g @waitloop/cli@alpha
waitloop --version
waitloop doctor
```

## Coding-agent lifecycle

Waitloop supports the lifecycle states:

```text
idle | running | waiting | completed | failed
```

Claude Code, Cursor, and Codex lifecycle adapters are available. Reporting is fail-open and excludes prompt, source, repository path, working directory, transcript, tool input/output, assistant output, and native Agent session content.

Stop, failure, and session-end hooks finalize the latest state before native-session cleanup. Codex retains authority over command-hook review and trust; stable MCP configuration and lifecycle-hook trust are separate boundaries.

## Public Agent surfaces

```text
https://waitloop.run/agent.md
https://waitloop.run/agent.json
https://waitloop.run/llms.txt
https://waitloop.run/skills/waitloop/SKILL.md
https://waitloop.run/api/v1/rooms
https://waitloop.run/join/<join-code>
https://waitloop.run/mcp
```

`agent.json` is the machine-readable capability and release manifest. GitHub mirrors are declared for environments that cannot navigate directly to Markdown resources.

## Stable local MCP bridge

Runtime command:

```text
waitloop mcp
```

One-time installers:

```bash
waitloop mcp install codex
waitloop mcp install claude-code
```

Model-visible tools:

```text
open_game()
create_room()
join_room(code)
get_active_room()
leave_room()
get_turn()
wait_for_turn(timeoutMs?)
wait_for_room_update(afterRoomSeq, timeoutMs?)
play_move(expectedRevision, moveId)
comment(text)
yield_to_bot()
take_control()
```

MCP App-only tools:

```text
ui_get_game(roomId, uiToken)
ui_play_cards(roomId, uiToken, expectedRevision, cardIds)
ui_pass(roomId, uiToken, expectedRevision)
ui_hint(roomId, uiToken, expectedRevision, cursor?)
```

The bridge reuses existing Human Room HTTP, Room/Join HTTP, and remote Room MCP. Agent credentials, Human cookies, and the private `wlui_` App capability remain in separate local custody and are never returned through model-visible content.

## Human-operated MCP App

`open_game({gameId:"doudizhu", mode:"human-bots"})` creates an ordinary Human-controlled `bots` Room:

```text
seat-1 Human
seat-2 deterministic Bot
seat-3 deterministic Bot
```

The result links to:

```text
URI       ui://waitloop/doudizhu/v1
MIME      text/html;profile=mcp-app
protocol  2026-01-26
```

The self-contained App supports card selection, play, pass, hint, clear, refresh, and fullscreen when the Host permits it.

The Human-vs-bots App is response-driven. Human play/pass responses include the authoritative snapshot after synchronous Bot automation; `ui_hint` is read-only. `ui_get_game` is used only for explicit refresh, reopen, stale or uncertain-result recovery, and one-shot focus/visibility recovery. An idle mounted App performs no periodic Worker or Durable Object reads.

A real Codex Desktop session has rendered and operated this MCP App. In that session, safe JSON was model-visible while the Human-facing App rendered simultaneously. Visible JSON is therefore not evidence of render failure, and Agents must not automatically open a separate browser game.

Unsupported Hosts receive a safe result and fallback guidance. The standalone Web fallback starts a separate game; it does not resume the private inline Room.

## Room event and waiting model

Snapshots contain two separate versions:

```text
revision
  game mutation concurrency
  used by play/pass expectedRevision

roomSeq
  semantic Room event cursor
  used by Room observers
```

`roomSeq` advances for client-visible semantic changes such as game actions, comments, Controller changes, Room phase changes, Join transitions, and meaningful Actor status changes. Heartbeat-only timestamps and credential-only writes do not advance it.

`wait_for_turn()` is Controller/actionable-turn oriented. `wait_for_room_update(afterRoomSeq, timeoutMs?)` is a read-only, cancellable semantic-event wait for Controllers and Advisors. Both are bounded current-run primitives; neither can wake an Agent after it has sent a final response.

Future private subscription reuse must be keyed by at least:

```text
server origin
+ Room ID
+ authorized principal / credential scope
+ projection type and version
```

It must never be keyed only by Room ID because Human, Controller, Advisor, Agent, and future spectator projections may contain different private data.

## Identity and control model

```text
Room       one runtime/game instance
Seat       stable room-scoped game position
Actor      Human | Bot | Hosted Agent | Connected Agent
Binding    Actor -> Seat relationship
Controller Actor currently allowed to mutate the Seat
Advisor    bound Actor allowed to inspect/comment but not play until delegated
```

Actor, Seat, and Room IDs are identifiers, not credentials. Temporary Bot fallback changes Controller only; Seat ID, owner, cards, role, and history remain unchanged.

## Current Dou Dizhu modes

```text
bots
hosted-agent
connected-agent
companion-agent
agent-bots
```

- `bots`: Human plus two deterministic Bots; used by standalone Web and `open_game`.
- `connected-agent`: Human and connected Agent occupy different Seats.
- `companion-agent`: connected Agent is Advisor of the Human Seat until explicit delegation.
- `agent-bots`: connected Agent owns `seat-1` against two deterministic Bots; fully headless.

Landlord selection is currently random before play. Full bidding, rob-landlord, settlement, and multipliers are not implemented.

## Room and Join lifecycle

```text
Room lifetime       about 24 hours
Join lifetime       about 20 minutes
Join claim          one-time
Room Actor token    reconnectable while Room is active
```

Join success is credential claim/cache, not proof that an arbitrary MCP client is connected. Local `join_room` and `create_room` authenticate the first gameplay request before reporting `connected: true`.

`leave_room()` clears only local Agent Room selection. It does not revoke the remote credential or mutate the Room. Human MCP App Rooms use separate private state under `~/.waitloop/app-rooms`.

## Security baseline

Implemented safeguards include:

- bounded JSON request bodies;
- Cloudflare Room-create and tighter hosted-room limits;
- per-Room/per-Actor Join, MCP, mutation, comment, control, and recovery limits;
- one-time Join and bounded Room expiry;
- hashed server credential storage;
- server-side capability and revision checks;
- hidden-information projection tests;
- local Agent credential custody and credential-shaped error redaction;
- private Human cookie custody;
- App capability delivery only through result `_meta`;
- independent capability verification on every App-only Human tool;
- no direct credentialed network traffic from the embedded App;
- cancellation propagation only for safe read/wait operations;
- CI-gated Cloudflare deployment and clean-main manual deployment.

Rate limiting is abuse protection, not accounting.

## Validation

The full regression and contract suite covers rules, identity, Controller fallback, lifecycle finalization, CLI configuration, MCP stdio/App wire behavior, Human session custody, request budgets, Room sequencing, bounded waits, hidden-information boundaries, public Agent surfaces, package contents, browser JavaScript, documentation hygiene, public-asset hygiene, and Worker dry-run validation.

Web incident tests are collected from `apps/web/test`, not deployable static assets. CI rejects test, fixture, TypeScript, or `__tests__` content under `apps/web/public`.

## Current maintenance priority

New product modes are paused. Structural work proceeds in behavior-preserving stages:

1. extract duplicated bounded MCP read/wait orchestration;
2. split `GameRoom` responsibilities without changing Durable Object RPC names or stored schema;
3. split Room HTTP routing from domain layout/auth/action logic;
4. split standalone Web rendering, API, actions, refresh, and lifecycle modules;
5. split CLI command dispatch and MCP App source assembly;
6. reduce duplicated release/tool facts across public and canonical documentation.

Each stage must preserve public protocols, credential boundaries, stored Room compatibility, and the `Seat / Actor / Controller` plus `revision / roomSeq` models.

## Known gaps

- authorized push subscription transport using `roomSeq` is not implemented;
- Human snapshot WebSocket/subscription protocol is not implemented;
- one-step local companion creation/binding is not implemented;
- bound, authenticated/connected, actively listening, and ended Agent-run states are not yet one integrated companion experience;
- proactive list/revoke/cleanup for local Human App sessions is not implemented;
- same-Room transfer from MCP App to standalone browser is intentionally unsupported without a short-lived transfer capability;
- multiple connected Actors, multiple Advisors, public spectators, and per-turn leases remain future work;
- full Dou Dizhu bidding and scoring remain future work;
- hosted inference accounting, wider lifecycle limits, CSP/CORS hardening, DSH support, accounts/global history, and Arena mode remain future work.

Forward-looking priorities live in [`roadmap.md`](roadmap.md).
