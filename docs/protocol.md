# Protocol

Waitloop uses small versioned protocols so vendor-specific coding-agent details stay outside core runtime and clients cannot bypass game authorization.

## Lifecycle protocol

Canonical coding-agent states:

```text
idle | running | waiting | completed | failed
```

Lifecycle events intentionally contain no prompt/source/repository/cwd/transcript/tool/assistant/native-session payloads. Lifecycle is a separate credential/protocol from game participation.

## Game identity

```ts
interface GameSeatV1 {
  version: 1;
  id: string;                 // stable within one Room
  label: string;
  ownerActorId: string;
  activeControllerActorId: string;
}

interface GameActorV1 {
  version: 1;
  id: string;
  kind: "human" | "bot" | "hosted-agent" | "connected-agent";
  label: string;
  temporary?: boolean;
}

interface GameActorBindingV1 {
  version: 1;
  actorId: string;
  seatId: string;
  relation: "controller" | "advisor";
}
```

New Dou Dizhu Rooms use `seat-1`, `seat-2`, `seat-3`. Seat/Actor IDs are context identifiers, never credentials.

Runtime capabilities include:

```text
room:view-public
room:manage
seat:view-private
seat:inspect-legal
seat:play
seat:control
room:comment
```

## Runtime state

Room phase:

```text
waiting_for_players | playing | paused | finished
```

Actor status:

```text
ready | waiting | connecting | connected | disconnected
```

Snapshots augment the game projection with:

```text
actors[]
seats[]
bindings[]
actorStates[]
comments[]
viewerActorId
viewerSeatId
roomOwnerActorId
capabilities[]
roomPhase
turnStartedAt
createdAt
expiresAt
```

Human browser snapshots remove exhaustive `legalMoves[]` and expose `canPlay/canPass/canHint`.

## Anonymous browser Actor identity

Browser creation can issue a persistent anonymous identity:

```text
actorId      actor_...
credential   wla_...
```

The pair is stored in an HttpOnly cookie. Only the credential digest is persisted in each Room. Actor ID without credential does not authenticate.

If the room-specific viewer cookie is absent, the browser can present the anonymous Actor cookie indirectly (normal cookie transport); the Worker verifies the Room's stored digest and issues a new `wlview_...` room viewer credential.

## Room API

Control-plane endpoints include:

```text
POST /api/v1/rooms
GET  /api/v1/rooms/:roomId
POST /api/v1/rooms/:roomId/play
POST /api/v1/rooms/:roomId/pass
POST /api/v1/rooms/:roomId/hint
POST /api/v1/rooms/:roomId/control
POST /api/v1/rooms/:roomId/fallback
POST /api/v1/rooms/:roomId/pause
POST /api/v1/rooms/:roomId/resume
```

`/control` chooses another Actor already bound to the Human-owned Seat.

`/fallback` accepts:

```json
{
  "version": 1,
  "targetSeatId": "seat-2",
  "action": "bot"
}
```

or `"action":"owner"`. Only Room owner or target Seat owner may perform it. Temporary Bot takeover changes Controller only.

Headless room creation remains available through `mode:"agent-bots"`.

## Join protocol

```text
GET  /api/v1/join/<join-code>
POST /api/v1/join/<join-code>/claim
GET  /join/<join-code>
```

Current new-Room semantics:

```text
Join expires ~20 min
Join can issue one room Actor credential
Room expires ~24 h
claimed room Actor credential may reconnect while Room is active
```

Claim response includes:

```text
roomId
actorId
seatId
relation
seatStatus
expiresAt          Join expiry
roomExpiresAt      Room expiry
seatToken          room Actor credential
mcp                fixed endpoint + headers
```

The `wlseat_` prefix is retained for compatibility even though authorization is Actor-binding scoped.

## MCP protocol

Transport headers:

```text
Authorization: Bearer <wlseat_...>
X-Waitloop-Room: <room-id>
```

Tools:

```text
get_turn()
play_move(expectedRevision, moveId)
comment(text)
yield_to_bot()
take_control()
```

`yield_to_bot` is valid only for an Actor that owns and actively controls its Seat. It adds a temporary Bot Actor/controller to the same Seat and preserves the original owner.

`take_control` is valid for the reconnected Seat owner and removes the temporary Bot controller.

Reconnect itself only updates Actor presence; it does not change `activeControllerActorId`.

## Revisions and errors

Game revision protects game mutations; comments/controller presence metadata do not invent alternative game rules.

Relevant error codes include:

```text
stale_revision
not_active_controller
not_seat_owner
invalid_controller
controller_not_ready
room_manage_forbidden
invalid_actor_credential
rate_limited
join_expired
join_already_claimed
```

JSON errors remain:

```json
{
  "version": 1,
  "error": {
    "code": "...",
    "message": "..."
  }
}
```

HTTP 429 is used for rate-limited public/runtime operations.

The Worker implementation is runtime truth; protocol docs must change in the same PR as public behavior.
