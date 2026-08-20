# Architecture

## Overview

Waitloop is one TypeScript/Cloudflare Worker deployment with Static Assets and Durable Objects.

```text
coding lifecycle
Claude/Cursor/Codex -> integrations -> protocol -> AgentSession DO

control plane
Web / CLI / Agent HTTP -> Room + Join APIs -> GameRoom DO

play plane
Human browser -----------------------> GameRoom DO
Connected Agent -> room-scoped /mcp -> GameRoom DO
Hosted provider -> hosted runner ----> GameRoom DO
```

Web is a Human client, never a prerequisite for Agent-only operation.

## Responsibility boundaries

```text
packages/protocol       lifecycle contracts
packages/game-core      pure game-agnostic room/state contracts
packages/doudizhu       pure Dou Dizhu rules
packages/cli            local convenience / lifecycle integration / Join cache
integrations/*          vendor lifecycle adapters
worker/*                HTTP control plane, DO runtime, MCP, hosted inference
apps/web/public/*        Human UI + public Agent surfaces
```

## GameRoom storage model

One `GameRoom` Durable Object persists everything needed to recover one Room:

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

No database/D1 is required for one-Room resume/control. Global account/history queries are intentionally deferred until product requirements need a cross-Room index.

## Stable Seat / replaceable Controller

Game packages know only stable room-scoped Seat IDs (`seat-1`, `seat-2`, `seat-3`). Runtime maps Actors onto Seats.

```text
Seat
  ownerActorId
  activeControllerActorId
```

Temporary Bot takeover adds a temporary Bot Actor/binding and changes only `activeControllerActorId`. The same Seat remains in the pure game state, so cards/role/history do not move.

When owner resumes, runtime removes that temporary Actor and restores Controller.

## Anonymous Human identity

Browser rooms have two credential layers:

```text
wl_actor cookie
  actorId + wla_... persistent anonymous credential (~180 d browser/device identity)

wl_room_<room> cookie
  wlview_... room viewer credential (~6 h convenience credential)
```

The Room stores only digests. If the room viewer cookie is gone, the Worker verifies `wl_actor` against that Room and mints another `wlview_...`.

This design lets a Human return to a Room without introducing an account service or central identity database. Actor ID alone is not authorization.

## Connected Actor recovery

Join remains one joined Actor capability for current modes:

```text
Join code (~20 min, one-time)
  -> wlseat_... room Actor credential
  -> first MCP request = connected/readiness
```

The CLI caches that room credential plus Actor/Seat/relation/Room expiry. During the ~24 hour Room lifetime, the same credential can reconnect.

Explicit recovery path:

```text
yield_to_bot()
-> temporary Bot controls same Seat
-> Actor reconnects
-> take_control()
-> owner controls same Seat again
```

Reconnect updates presence only. It does not implicitly alter Controller.

## Room lifetime

New Rooms set `createdAt` and `expiresAt` with a ~24 hour lifetime. On access after expiry, `GameRoom` removes active Room state and behaves as not found.

This is intentionally a lightweight active-Room model, not historical storage.

## Abuse protection

Two layers:

### Worker edge binding

Cloudflare native Rate Limiting bindings protect:

```text
room creation          30/min per remembered Actor, IP fallback for anonymous/headless
hosted room creation    5/min
```

### Per-GameRoom Durable Object counters

Protect Join claim, Actor recovery, MCP connect/read/move/comment/control, and Human mutation/control operations.

These limits reduce abuse and inference/state amplification; they are not exact accounting.

Request JSON is also capped at 16 KiB.

## HTTP vs MCP

Current contract deliberately stays:

```text
HTTP / CLI
  create room
  claim Join
  Human owner control/fallback

room-scoped MCP
  get_turn()
  play_move(expectedRevision, moveId)
  comment(text)
  yield_to_bot()
  take_control()
```

The gameplay MCP cannot create the Room needed to authenticate itself. If a tool-based control plane is useful later, it should wrap the existing HTTP control plane rather than duplicate Room logic.

## Backward compatibility

Older Rooms where participant==Seat==Actor are normalized on read into Actor/Seat/Binding state. New code uses explicit `actors`, `seats`, `bindings`, and `actorStates`.

## Trust/concurrency

- all external input validated at HTTP/MCP boundaries;
- raw credentials never model-visible tool arguments;
- hidden views derived from bound Seat;
- capability checks decide Controller/owner actions;
- Durable Object serialization + game revision reject stale concurrent moves;
- reconnect/fallback does not bypass revision or ownership.

## Future global identity/database boundary

Introduce a database/global registry only for needs such as cross-device accounts, Room history, profiles, social relationships, ranking, or cross-Room queries. Do not make that infrastructure a prerequisite for anonymous one-Room recovery.
