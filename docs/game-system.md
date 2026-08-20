# Game system

This document defines the durable game/runtime contract. Game legality belongs in pure game packages; Room identity, Actor bindings, readiness, authorization, recovery, and presentation belong in the runtime.

## Authority model

`packages/game-core` owns generic game-room revision/stale-turn checks. `packages/doudizhu` owns Dou Dizhu rules. `GameRoom` owns runtime identity/capability/persistence around the pure game.

Clients never become state authority.

## Stable Seat vs Actor

```text
Room
  Seat        stable room-scoped player position
  Actor       human | bot | hosted-agent | connected-agent
  Binding     Actor -> Seat
  Controller  Actor currently allowed to play Seat
  Advisor     bound Actor that can inspect/comment but not play until delegated
```

New three-player Dou Dizhu Rooms use `seat-1`, `seat-2`, `seat-3`. These IDs remain stable through Controller changes.

A Seat owns the game identity: hand, landlord/farmer role, history, and turn position. Actor changes do not rewrite that identity.

Actor ID and Seat ID are identifiers, never authorization secrets.

## Ownership and capabilities

Seats track:

```text
ownerActorId
activeControllerActorId
```

Current important capabilities:

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
- Only active Controller gets `seat:play`.
- Advisor can inspect/comment on its explicitly bound Seat but cannot play until delegated.

Server capability checks are authoritative.

## Anonymous Human Actor recovery

Public browser rooms do not require an account.

A browser receives:

```text
Actor ID      actor_...
credential    wla_...  (separate secret)
```

Both travel only in an HttpOnly cookie. The Actor credential digest is stored in each Room where that Actor participates.

The shorter `wl_room_...` viewer cookie authorizes normal Human room operations. If it is lost/expired while the anonymous Actor cookie remains valid, the Room can verify the Actor credential and mint a fresh room viewer credential.

This is browser/device-local anonymous persistence. It is not cross-device identity or a global account database.

## Runtime phases and Actor state

Room phase:

```text
waiting_for_players -> playing -> paused -> playing -> finished
```

Actor runtime state:

```text
ready | waiting | connecting | connected | disconnected
```

The first authenticated MCP request marks a joined connected Actor ready and starts a one-joined-Actor waiting Room.

Current fallback/disconnect behavior is explicit; there is no transport idle detector that automatically declares a slow Agent disconnected.

## Temporary Bot takeover

An eligible Human/connected-Agent Seat can explicitly hand control to a deterministic temporary Bot.

```text
before:
seat-2
  owner = actor-codex
  controller = actor-codex

fallback:
seat-2
  owner = actor-codex
  controller = temporary-bot
```

Unchanged:

```text
Seat ID
hand
role
history
ownerActorId
```

The temporary Bot is an Actor bound to the same Seat and the Seat is temporarily added to deterministic bot automation.

When the owner is ready again:

```text
restore owner
```

removes only the temporary Actor/binding and restores `activeControllerActorId` to the original owner.

No elapsed Casual timer triggers this automatically.

## Connected Actor yield/reconnect/reclaim

MCP Seat owners may call:

```text
yield_to_bot()
```

before stepping away. The same claimed room credential is cached/reconnectable during Room lifetime.

On reconnect, Actor presence becomes connected again but Controller authority does not silently move away from the temporary Bot. Owner explicitly calls:

```text
take_control()
```

This avoids concurrent mutation and makes takeover observable/intentional.

## Room and Join lifetime

Current values for new Rooms:

```text
Join capability    ~20 minutes, one-time claim
Room               ~24 hours
room Actor token   usable for reconnect while Room is active
```

Expired Room state is lazily removed when read. Global historical indexing is intentionally not implemented yet.

## Human / machine projections

### Human browser

- viewer-specific private Seat state;
- no exhaustive machine `legalMoves[]`;
- `canPlay/canPass/canHint` reflect current Controller authority;
- Human owner may still see its hand while another Actor controls the Seat.

### Connected/hosted Actor

- private projection only for bound Seat;
- server-generated legal move IDs;
- exact Room revision required for mutation.

An unrelated Actor never receives another Seat's hidden hand.

## Client-neutral Room creation

Web is optional. HTTP/CLI form the control plane; room-scoped MCP is gameplay.

```http
POST /api/v1/rooms
Content-Type: application/json

{"version":1,"gameId":"doudizhu","mode":"agent-bots"}
```

returns Room/Join data. Agent claims Join, then uses `/mcp`.

Do not duplicate Room creation/business rules in Web/CLI/MCP clients.

## Side-channel comments

`comment(text)` is stored outside game action history and does not change:

- game state;
- revision;
- turn;
- legal moves.

## Automated players

Native and temporary rule Bots use authoritative legal moves with no model call. Hosted models receive only their Seat projection/legal moves; provider timeout is infrastructure protection, not a Casual turn timeout.

## Human-visible pacing

Worker/domain logic does not sleep. Browser may replay authoritative history deltas while keeping presentation state distinct from authoritative current turn.

Player rows may expose Seat label, Controller/runtime state, and explicit fallback/restore actions.

## Testing expectations

- rule changes: pure game regression tests;
- Actor/Seat changes: capability/identity tests;
- fallback: preserve owner/Seat, remove only temporary Actor, reject native-Bot replacement;
- recovery: ID alone must not authenticate; credentials required;
- advisor: private bound-Seat view without play permission;
- browser projection: hidden-information non-leakage;
- stale/out-of-turn/non-controller mutations remain rejected;
- generic runtime must not contain Dou Dizhu pattern logic.
