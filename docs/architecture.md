# Architecture

## Overview

Waitloop is one TypeScript/Cloudflare Worker deployment with Static Assets and Durable Objects, plus a published Node CLI that can run a stable local stdio MCP bridge.

```text
coding lifecycle
Claude/Cursor/Codex -> lifecycle adapters -> protocol -> AgentSession DO

Agent control/game path
Codex/Claude
  -> stable stdio MCP: waitloop mcp
      -> Room/Join HTTP control APIs
      -> remote room-scoped /mcp
          -> GameRoom DO

Human path
Web -> Room APIs / Human projection -> GameRoom DO

Hosted path
Web/Room API -> hosted runner -> GameRoom DO
```

Web is a Human client, never a prerequisite for Agent-only operation.

## Responsibility boundaries

```text
packages/protocol       lifecycle contracts
packages/game-core      pure game-agnostic room/state contracts
packages/doudizhu       pure Dou Dizhu rules
packages/cli            local config, diagnostics, lifecycle install, active Room, stdio MCP bridge
integrations/*          vendor lifecycle adapters
worker/*                HTTP control plane, DO runtime, remote MCP, hosted inference
apps/web/public/*        Human UI + public Agent surfaces
```

Web/CLI/local MCP/raw HTTP/remote MCP converge on shared server runtime. Clients do not implement alternate Room rules or authorization.

## Local MCP bridge

The bridge is stable harness configuration:

```text
command: waitloop
args: ["mcp"]
```

It has two internal client paths:

```text
control tools
  create_room / join_room
  -> existing HTTP Room/Join endpoints

gameplay tools
  get_turn / wait_for_turn / play_move / comment / yield / take_control
  -> existing remote Room MCP
```

The same stdio process supports MCP 2026-07-28 discovery and supported legacy initialize clients. The current implementation keeps this compatibility layer small and local rather than adding a second business/runtime stack.

The bridge owns no long-lived server state. It resolves one local active Room pointer and private cached Room credential under `~/.waitloop/joins`.

Security boundary:

```text
model sees       safe Room/Actor/Seat metadata + snapshots
local bridge     raw Room Actor credential
server           credential digest + authoritative Room state
```

No raw credential is returned by local MCP tools.

### In-flight request and cancellation model

Stdio input remains readable while long tools are pending. Each request with an ID receives its own `AbortController`:

```text
stdio request id N
  -> local handler
      -> Room HTTP / remote MCP fetch
          -> Worker request signal
              -> wait_for_turn poll loop

notifications/cancelled { requestId: N }
  -> abort controller N
  -> abort proxied fetch
  -> abort Worker wait delay
  -> suppress stale local response for N
```

Requests are not globally serialized behind `wait_for_turn`. Duplicate in-flight request IDs are rejected. Stdio shutdown aborts remaining requests before bridge exit.

Cancellation affects transport execution only. Game mutation still requires the ordinary capability/revision-controlled tools.

## Active Room model

```text
~/.waitloop/joins/WL-....json   private claimed credential/context
~/.waitloop/joins/active.json  code + server selection only
```

`waitloop join`, local `join_room`, and local `create_room` update active selection. A new bridge process can resume the same selection while the Room credential is valid.

`leave_room` removes only active selection; it does not revoke or mutate the remote Room.

Remote Room expiry/authentication failures clear a stale active pointer. The cached credential file remains governed by the existing cache/expiry policy.

## GameRoom storage model

One `GameRoom` Durable Object persists one Room:

```text
game state
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

Pure game packages know stable `seat-1`, `seat-2`, `seat-3`. Runtime maps Actors onto Seats.

```text
Seat
  ownerActorId
  activeControllerActorId
```

Temporary Bot takeover changes only Controller and adds/removes a temporary Bot Actor/binding. Cards, role, Seat ID, owner, and history remain in the same pure game position.

## Connected Actor lifecycle

```text
Room created
-> waiting_for_players
-> Join claimed
-> credential cached / active Room selected
-> first authenticated remote MCP request
-> Actor connected / Room playing
```

Local `join_room` and `create_room` include the first authenticated request, so they report connected only after GameRoom accepts the credential.

Reconnect updates presence only. It does not implicitly reclaim Controller from a temporary Bot.

## Efficient waiting

Remote `wait_for_turn` is implemented above existing authenticated snapshot RPC:

```text
remote MCP handler
  -> GameRoom.getSnapshotBySeatToken
  -> classify actionable state
  -> bounded wait/poll (about 750 ms, max 25 s)
```

This avoids model-driven tight polling without adding a Casual game clock. The wait returns on turn, terminal/lifecycle state, Controller change, or transport timeout.

The HTTP request `AbortSignal` is checked before/after snapshot reads and drives an abort-aware poll delay. Client cancellation therefore ends remote waiting promptly instead of leaving the Worker loop alive until the 25-second bound.

The local bridge does not run a background Agent scheduler; the harness must keep the current Agent run alive for continuous play.

## Local client failure classification

Transport and remote tool failures are normalized into model-safe local MCP errors when the bridge can classify them:

```text
code
message
nextAction?   safe corrective action when known
retrySafe?   conservative repeatability signal
```

Read-only `get_turn`/`wait_for_turn` transport failures can be retry-safe. Mutating transport failures are not automatically retry-safe because the remote outcome may be uncertain; the recovery step is `get_turn()` before deciding whether to replay.

## Anonymous Human identity

Browser rooms use:

```text
wl_actor
  actorId + wla_... persistent browser/device credential

wl_room_<room>
  wlview_... Room viewer credential
```

Only digests are stored. Actor ID alone is not authorization. This supports one-Room browser recovery without accounts/database.

## Room lifetime and cleanup

New Rooms are bounded to about 24 hours. Join capability is about 20 minutes and one-time. Room state is lazily removed on access after expiry.

CLI active/Join cache is also lazily validated: expired Room credentials are ignored/removed and stale active selection is cleared.

## Abuse protection

### Edge

```text
Room creation       30/min per remembered Actor, IP fallback
Hosted Room create   5/min
```

### Per GameRoom Actor

Join claim, recovery, remote MCP connect/read/move/comment/control, and Human mutations have bounded counters.

`wait_for_turn` uses authenticated reads within the existing MCP-read budget and caps one call at 25 seconds. Cancellation can release a pending wait early. Rate limits are abuse controls, not accounting or game timing.

Request JSON is capped at 16 KiB.

## HTTP vs MCP

The durable separation is:

```text
HTTP
  server control protocol

remote /mcp
  already-authorized Room Actor gameplay protocol

local waitloop mcp
  stable Agent-facing facade that wraps both

CLI
  human/script commands over the same local clients
```

`create_room` belongs to the local bridge, not remote room-scoped MCP. This avoids the bootstrap cycle where a Room-scoped transport would need a Room credential before creating its own Room.

## Backward compatibility

Older Rooms where participant==Seat==Actor are normalized on read. New code uses explicit Actors, Seats, Bindings, Actor state, and capabilities.

CLI `--raw-mcp` preserves advanced remote configuration access, but default Join output is credential-safe and local bridge-first.

The local stdio compatibility layer currently accepts modern 2026-07-28 discovery and a bounded set of legacy initialize protocol versions. Real Codex/Claude compatibility remains part of stabilization acceptance testing.

## Trust/concurrency

- all HTTP/local-MCP/remote-MCP inputs are validated;
- raw credentials are never model-visible local tool results;
- hidden projection derives from bound Seat;
- capability checks decide Controller/owner actions;
- Durable Object serialization + revision reject stale concurrent moves;
- local MCP in-flight request IDs have independent cancellation scopes;
- cancelled waits suppress stale result delivery;
- wait timeout/cancellation never authorize game mutation;
- reconnect/fallback never bypasses ownership or revision.

## Future database boundary

Introduce global storage only for cross-device accounts, Room history, profiles, social relationships, ranking, or cross-Room queries. It is not required for current local active Room and one-Room recovery.
