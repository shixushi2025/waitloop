# Architecture

## Overview

Waitloop is one TypeScript/Cloudflare Worker deployment with Static Assets and Durable Objects, plus a published Node CLI that runs lifecycle adapters and a stable local stdio MCP bridge.

```text
coding lifecycle
Claude/Cursor/Codex -> lifecycle adapters -> protocol -> AgentSession DO

Human inside Agent Host
Agent conversation
  -> local stdio MCP: waitloop mcp
  -> open_game()
  -> ui://waitloop/doudizhu/v1 MCP App
  -> app-only Human tools
  -> existing Human Room HTTP APIs
  -> GameRoom DO

Agent-controlled game
Codex/Claude
  -> local stdio MCP: waitloop mcp
      -> Room/Join HTTP control APIs
      -> remote room-scoped /mcp
          -> GameRoom DO

Standalone Human path
Web -> Room APIs / Human projection -> GameRoom DO

Hosted path
Web/Room API -> hosted runner -> GameRoom DO
```

Standalone Web is a Human client, never a prerequisite for Agent-only operation. An MCP Apps-capable Host can also embed a Human client directly in the Agent conversation.

## Responsibility boundaries

```text
packages/protocol       lifecycle contracts
packages/game-core      pure game-agnostic room/state contracts
packages/doudizhu       pure Dou Dizhu rules
packages/cli            local config, diagnostics, lifecycle install, Agent Room state,
                        Human MCP App state, stdio MCP bridge, self-contained App resource
integrations/*          vendor lifecycle adapters
worker/*                HTTP control plane, DO runtime, remote Agent MCP, hosted inference
apps/web/public/*        standalone Human UI + public Agent surfaces
scripts/*                repository contracts, packaging, MCP/MCP Apps wire, deployment gates
```

Web, CLI, local MCP, MCP App, raw HTTP, and remote MCP converge on the same authoritative GameRoom runtime. Clients do not implement alternate rules or authorization.

## CI and production deployment

GitHub Actions runs on `main`, pull requests, and `fix/**` branches.

```text
check
  -> strict typecheck + full regression suite
  -> repository + onboarding contracts
  -> CLI package validation
  -> packaged MCP stdio + MCP App resource validation
  -> embedded App JavaScript syntax validation
  -> browser / Agent surface validation
  -> Wrangler dry-run

verify-cloudflare-gate
  -> query the completed GitHub Actions check through the Checks API

ready-to-deploy
  -> succeeds only when both jobs succeeded
```

Cloudflare Workers Builds starts independently when `main` is pushed, but production promotion is gated:

```text
Cloudflare automatic dependency install
  -> root postinstall
  -> scripts/cloudflare-ci-gate.mjs
  -> wait for ready-to-deploy on WORKERS_CI_COMMIT_SHA
  -> fail on failed/cancelled/timed-out CI
  -> only then continue to wrangler deploy
```

The root `postinstall` skips ordinary local installation and non-production Cloudflare branches. Explicit `pnpm deploy` is allowed only from a clean local `main`, checks `origin/main` when available, and requires that exact commit's `ready-to-deploy` result. Uncommitted, staged, untracked, detached-HEAD, and feature-branch deployment fails before upload.

## Local MCP bridge

Stable harness configuration:

```text
command: waitloop
args: ["mcp"]
```

The bridge has three internal client paths:

```text
Human UI entry
  open_game
  -> existing Human bots Room HTTP create
  -> private Human cookie custody
  -> MCP App result/resource

Agent control entry
  create_room / join_room
  -> existing Room/Join HTTP endpoints

Agent gameplay
  get_turn / wait_for_turn / wait_for_room_update / play_move / comment / yield / take_control
  -> existing remote Room MCP
```

The bridge owns no authoritative game state. It stores only local credentials/context and proxies authoritative operations to GameRoom.

## Human MCP App architecture

### Resource and trigger

`open_game()` is linked to:

```text
ui://waitloop/doudizhu/v1
text/html;profile=mcp-app
MCP Apps protocol 2026-01-26
```

Tool metadata publishes both:

```text
_meta.ui.resourceUri
_meta["ui/resourceUri"]
```

The resource is self-contained HTML/CSS/JavaScript with no external dependency and no direct credentialed network traffic.

### App/Host protocol

```text
Host reads ui:// resource
  -> sandbox iframe
  -> ui/initialize
  -> ui/notifications/initialized

Host forwards open_game result
  -> ui/notifications/tool-result
  -> App receives safe snapshot + private result _meta

Human clicks
  -> App tools/call
  -> Host proxies to local MCP
  -> app-only Human tool
  -> existing Room HTTP API
```

The App also supports host-context changes, size notifications, display-mode requests, external-link requests, and teardown.

### Browser request budget

The Human-vs-bots MCP App is action-driven. Room mutations return the authoritative snapshot after deterministic Bot moves, so an open idle App does not poll the Worker. Explicit refresh, reopen/error recovery, and a one-shot visible/focus refresh use `ui_get_game`.

The standalone connected/companion Web table still needs remote updates while another Actor may act. It polls only while visible, starts at one second after visible state changes, doubles through 2/4/8 seconds, and caps unchanged state at ten seconds. Hidden/pagehide views stop the timer. Heartbeat-only `lastSeenAt` changes do not reset the backoff.

Failed lifecycle WebSocket reconnects use exponential backoff up to 30 seconds and stop while hidden or torn down. This prevents a broken endpoint or abandoned view from becoming an unbounded Worker-invocation source.

### Human versus Agent ownership

```text
open_game
  Human owns/controllers seat-1
  existing `bots` mode

create_room
  Agent owns/controllers seat-1
  existing `agent-bots` mode
```

This split is architectural. The App must not reuse an Agent credential or make the Human appear as an Agent Actor.

### Human private session

The Worker returns standard Human cookies during Room creation:

```text
wl_actor
wl_room_<room>
```

The local bridge stores them under:

```text
~/.waitloop/app-rooms/<sha256(room-id)>.json
```

Each record also contains a random `wlui_...` capability. The safe `open_game` result contains only Room ID, snapshot, and fallback information. The App capability is delivered only through:

```text
result _meta["waitloop/uiToken"]
```

App-only tools require both Room ID and that capability. The local bridge performs constant-time comparison before reading/using Human cookies.

Security boundary:

```text
model sees       safe Human snapshot + fallback description
embedded App     safe snapshot + private wlui_ capability from result _meta
local bridge     wlui_ capability + raw Human cookies
server           credential digests + authoritative Room state
```

Host app-only visibility is defense in depth. Capability verification remains necessary if a Host exposes tool names incorrectly.

### Host fallback

A Host must render MCP Apps, preserve result `_meta`, and proxy App `tools/call` for inline interaction. Unsupported Hosts receive a safe result and a link to:

```text
https://waitloop.run/game.html
```

That URL starts a separate browser-controlled game. The same private inline Room is not transferred because Waitloop does not put Human credentials in URLs.

## Agent active Room model

Agent Rooms remain separate:

```text
~/.waitloop/joins/WL-....json   private claimed Agent credential/context
~/.waitloop/joins/active.json  code + server selection only
```

`waitloop join`, `join_room`, and Agent-owned `create_room` update active Agent selection. A new bridge process can resume while the Room credential is valid.

`leave_room` removes only Agent active selection; it does not revoke or mutate the remote Room.

Interactive Human Rooms are reopened explicitly with `open_game(roomId)` and do not replace the active Agent pointer.

## GameRoom storage model

One `GameRoom` Durable Object persists one Room:

```text
game state
roomSeq semantic event cursor
Seats
Actors
Bindings
Actor runtime/presence
Room owner
active Controllers
viewer/Actor/MCP credential digests
Join state
comments
temporary Bot takeover state
createdAt / expiresAt
hosted usage stats
```

No database/D1 is required for one-Room resume/control. Global identity/history is deferred until cross-Room querying is a real requirement.

## Stable Seat / replaceable Controller

Pure game packages know stable `seat-1`, `seat-2`, and `seat-3`. Runtime maps Actors onto Seats.

```text
Seat
  ownerActorId
  activeControllerActorId
```

Temporary Bot takeover changes only Controller and adds/removes a temporary Bot Actor/binding. Cards, role, Seat ID, owner, and history remain in the same pure game position.

## Connected Agent lifecycle

```text
Room created
-> waiting_for_players
-> Join claimed
-> credential cached / active Agent Room selected
-> first authenticated remote MCP request
-> Agent connected / Room playing
```

Local `join_room` and `create_room` include the first authenticated request. Reconnect updates presence only and does not implicitly reclaim Controller from a temporary Bot.

Human `open_game` does not use Join; the Human Room is immediately playable and authenticated through local cookie custody.

## Efficient waiting and synchronization

Remote Agent waits use the authenticated private snapshot:

```text
wait_for_turn
  -> classify Controller/actionable-turn state

wait_for_room_update(afterRoomSeq)
  -> classify semantic roomSeq advance or Room finish

both
  -> bounded cancellable read loop (about 750 ms, max 25 s)
```

These waits prevent model-driven tight polling without adding a Casual clock or background Agent scheduler.

The Human-vs-bots MCP App is response-driven. Initial and mutation results carry authoritative snapshots, and `ui_get_game` is used only for explicit refresh, reopen/error recovery, and one-shot focus/visibility recovery. An idle mounted App performs no periodic Worker read.

The standalone connected/companion Web table still uses bounded visible-document polling as a compatibility fallback while another Actor may change the Room. A future authorized push subscription will replace that fallback.

## Anonymous Human identity

Standalone Web and local MCP App Human Rooms share the server model:

```text
wl_actor
  actorId + wla_... persistent anonymous Human credential

wl_room_<room>
  wlview_... Room viewer credential
```

Only digests are stored in GameRoom. Actor ID alone is not authorization. The difference is custody:

```text
standalone Web  browser HttpOnly cookies
MCP App         local bridge private file, never iframe/model content
```

## Room lifetime and cleanup

New Rooms are bounded to about 24 hours. Join capability is about 20 minutes and one-time. Room state is lazily removed on access after expiry.

Agent Join cache and Human App cache are lazily validated. Expired local records are ignored/removed. Proactive list/revoke/cleanup for Human App sessions remains future work.

## Abuse protection

### Edge

```text
Room creation        30/min per remembered Actor, IP fallback
Hosted Room create    5/min
```

### Per GameRoom Actor

Join claim, recovery, remote MCP connect/read/move/comment/control, and Human mutations have bounded counters.

`wait_for_turn` uses existing MCP-read budget and caps one call at 25 seconds. Human MCP App calls reuse existing Human mutation/read controls. Rate limits are abuse controls, not accounting or game timing.

Request JSON is capped at 16 KiB.

## HTTP versus MCP

```text
HTTP
  authoritative server control/Human protocol

remote /mcp
  authorized Agent Actor gameplay protocol

local waitloop mcp
  stable Agent facade + local credential broker + MCP App server

MCP App
  sandboxed Human client over Host-proxied local tools

CLI
  human/script commands over the same local clients
```

`create_room` belongs to local MCP, not remote Room MCP, avoiding a bootstrap cycle. `open_game` also belongs locally because the bridge must retain Human cookie and App capability custody.

## Backward compatibility

Older Rooms where participant==Seat==Actor are normalized on read. New code uses explicit Actors, Seats, Bindings, Actor state, and capabilities.

CLI `--raw-mcp` preserves advanced Agent remote configuration access. It does not expose Human MCP App credentials.

## Trust/concurrency

- all HTTP/local-MCP/remote-MCP/App inputs are validated;
- raw Agent and Human credentials are never model-visible;
- App capability is absent from model content and required by app-only tools;
- hidden projection derives from bound Seat;
- capability checks decide Controller/owner actions;
- Durable Object serialization + revision reject stale concurrent moves;
- App and Agent mutation calls use exact revision semantics;
- wait timeout and UI refresh never authorize mutation;
- reconnect/fallback never bypasses ownership or revision;
- mutation-capable requests are not aborted under a false non-execution assumption;
- Cloudflare and explicit package deploys wait for the exact commit's final GitHub Actions gate;
- manual production deployment cannot substitute uncommitted content for the validated commit.

## Future database boundary

Introduce global storage only for cross-device accounts, Room history, profiles, social relationships, ranking, or cross-Room queries. It is not required for current Agent active Room, Human App local session, and one-Room recovery.
