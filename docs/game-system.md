# Game system

This document defines the durable game/runtime contract. Game legality belongs in pure game packages; Room identity, Actor bindings, readiness, authorization, recovery, and presentation belong in runtime. Local MCP/CLI are clients, never state authority.

## Authority model

```text
packages/game-core  generic revision/stale-turn contract
packages/doudizhu   pure Dou Dizhu rules
GameRoom DO         Room identity, capability, persistence, automation
Room/Join HTTP      server control protocol
remote /mcp         authenticated Room Actor gameplay
local waitloop mcp  stable Agent-facing bridge over HTTP + remote MCP
Web                  Human presentation
```

## Stable Seat vs Actor

```text
Room
  Seat        stable room-scoped player position
  Actor       human | bot | hosted-agent | connected-agent
  Binding     Actor -> Seat
  Controller  Actor currently allowed to play Seat
  Advisor     bound Actor that can inspect/comment but not play until delegated
```

New Dou Dizhu Rooms use `seat-1`, `seat-2`, `seat-3`. A Seat owns hand, landlord/farmer role, turn position, and history. Controller changes never rewrite that identity.

Room/Seat/Actor IDs are identifiers, not credentials.

## Ownership and capabilities

```text
ownerActorId
activeControllerActorId
```

Important capabilities:

```text
room:view-public
room:manage
seat:view-private
seat:inspect-legal
seat:play
seat:control
room:comment
```

- Room owner gets `room:manage`.
- Seat owner keeps `seat:control`.
- only active Controller gets `seat:play`.
- Advisor gets private inspect/comment only for its bound Seat until delegated.

## Runtime phases and connected readiness

```text
waiting_for_players -> playing -> paused -> playing -> finished
```

Actor state:

```text
ready | waiting | connecting | connected | disconnected
```

Connected flow:

```text
Room created
-> Join claimed
-> Actor connecting
-> first authenticated remote MCP request
-> Actor connected / waiting Room starts
```

Local `join_room` and `create_room` perform the first authenticated request before reporting connected.

## Game revision versus Room event sequence

Every snapshot exposes two independent monotonic concepts:

```text
game revision
  authoritative game mutation version
  required by expectedRevision for play/pass concurrency

roomSeq
  semantic Room-event version
  advances for any client-visible Room change, including comments,
  Controller/temporary-Bot changes, Room phase, Join claim, and
  meaningful Actor status transitions
```

Legacy persisted Rooms normalize to `roomSeq = 1`. All later state writes pass through a centralized commit helper that increments and broadcasts only when the semantic Room signature changes. Heartbeat-only `lastSeenAt` updates and credential-only recovery writes are persisted without advancing `roomSeq` or broadcasting.

Collection ordering is normalized before semantic comparison, so harmless array/map ordering differences do not create false events.

## Stable local Agent bridge

The stable stdio bridge exposes:

```text
create_room
join_room
get_active_room
leave_room
get_turn
wait_for_turn
play_move
comment
yield_to_bot
take_control
```

`create_room` currently maps to the existing headless `agent-bots` mode. `join_room` claims the existing Join protocol. Both select a local active Room; all gameplay tools proxy the authoritative remote Room MCP.

The bridge stores no alternate game state. It returns the same server snapshot projection and keeps credentials out of model-visible tool results.

## Efficient waiting

`wait_for_turn(timeoutMs?)` is an authenticated, bounded snapshot wait:

```text
if current Seat can play     -> your_turn
if Room terminal             -> game_finished
if waiting lobby             -> waiting_for_players
if paused                    -> room_paused
if Actor lost seat:play      -> controller_changed
if transport bound reached   -> timeout
otherwise re-read after ~750 ms
```

Maximum current wait is 25 seconds. Timeout is not a game mutation and never triggers auto-pass/auto-play/fallback.

A user request for continuous play still requires the Agent harness to keep its current run active and call the tool again after transport timeout.

## Temporary Bot takeover

An eligible Human/connected-Agent Seat can explicitly hand control to a deterministic temporary Bot.

```text
before: owner=Actor A, controller=Actor A
after:  owner=Actor A, controller=temporary Bot
```

Preserved:

```text
Seat ID
hand
role
history
ownerActorId
```

No elapsed Casual timer triggers takeover.

## Yield/reconnect/reclaim

```text
yield_to_bot()
-> active/cached Room credential remains
-> Agent or bridge may restart
-> get_active_room() / get_turn()
-> take_control()
```

Reconnect restores presence only. `take_control` is explicit and removes only the temporary Bot Actor/binding.

`leave_room` in local MCP clears local active selection only. It is not remote credential revocation.

## Anonymous Human Actor recovery

A browser receives `actor_...` plus separate `wla_...` secret in HttpOnly cookie. Each Room stores only the credential digest.

If the shorter Room viewer cookie is missing, the anonymous Actor credential may mint a fresh viewer credential during Room lifetime. Actor ID alone cannot authenticate. No cross-device account/database is implied.

## Room and Join lifetime

```text
Join capability    about 20 minutes, one-time
Room               about 24 hours
Room Actor token   reconnectable only while Room active
```

GameRoom and CLI cache perform lazy expiry cleanup.

## Projections

### Human browser

- viewer-specific private Seat state;
- no exhaustive machine legal move list;
- constrained action flags reflect `seat:play`;
- owner may still see own hand while delegated.

### Connected/hosted Actor

- private projection only for bound Seat;
- server-generated legal move IDs;
- exact revision required for mutation.

### Local bridge

- forwards the connected Actor projection unchanged;
- may add safe local active/connection metadata;
- never adds credentials or unrelated Seat state.

## Client-neutral control

Preferred Agent path is local MCP/CLI, but the server protocol remains HTTP:

```text
create_room -> POST /api/v1/rooms
join_room   -> POST /api/v1/join/<code>/claim
```

This allows Web, CLI, MCP bridge, tests, and advanced clients to reuse one control plane. The remote Room MCP remains room-scoped and cannot bootstrap its own credential.

## Side-channel comments

`comment(text)` is outside game action history and does not change game state, revision, turn, or legal moves.

## Automated players

Native and temporary Bots use authoritative legal moves with no model call. Hosted models receive only their Seat projection/legal moves. Provider timeout is infrastructure protection, not a Casual turn timeout.

A fully Bot-controlled table may finish within the bounded automated-action budget.

## Human-visible pacing

Worker/domain logic does not sleep for presentation. Browser replays authoritative history deltas separately from authoritative current turn.

## Testing expectations

- rule changes: pure game regression tests;
- Actor/Seat changes: capability/identity tests;
- fallback: preserve owner/Seat and remove only temporary Actor;
- recovery: identifier alone never authenticates;
- advisor: bound private view without play permission;
- wait: actionable reasons and timeout bounds, no mutation;
- local bridge: safe tool list, credential non-disclosure, headless create/join/connect;
- browser projection: hidden-information non-leakage;
- stale/out-of-turn/non-controller moves rejected;
- generic runtime contains no Dou Dizhu pattern logic.
