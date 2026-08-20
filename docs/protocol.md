# Protocol

Waitloop uses small versioned protocols so vendor-specific coding-agent details stay outside core runtime and clients cannot bypass game authorization.

## Lifecycle protocol

```text
idle | running | waiting | completed | failed
```

Lifecycle events contain no prompt/source/repository/cwd/transcript/tool/assistant/native-session payloads. Lifecycle credentials and game credentials are separate.

## Game identity

```ts
interface GameSeatV1 {
  version: 1;
  id: string;
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

New Dou Dizhu Rooms use `seat-1`, `seat-2`, `seat-3`. Room/Seat/Actor IDs are identifiers, not credentials.

Capabilities include:

```text
room:view-public
room:manage
seat:view-private
seat:inspect-legal
seat:play
seat:control
room:comment
```

## Runtime projection

Room phase:

```text
waiting_for_players | playing | paused | finished
```

Actor status:

```text
ready | waiting | connecting | connected | disconnected
```

Agent snapshots include:

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
revision
currentPlayerId
legalMoves[]
```

Human browser snapshots remove exhaustive machine `legalMoves[]` and expose constrained Human actions.

## Room HTTP control protocol

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

HTTP remains the server control protocol used by Web, CLI, local MCP, and advanced raw clients. It is not duplicated as separate game logic inside clients.

Headless `mode:"agent-bots"` creates one connected Agent Seat plus two deterministic Bot Seats and returns a Join code.

## Join protocol

```text
GET  /api/v1/join/<join-code>
POST /api/v1/join/<join-code>/claim
GET  /join/<join-code>
```

Current semantics:

```text
Join expires about 20 minutes
Join issues one room Actor credential
Room expires about 24 hours
claimed credential may reconnect while Room is active
```

Claim response includes:

```text
roomId
actorId
seatId
relation
seatStatus
expiresAt
roomExpiresAt
seatToken
mcp endpoint + headers
```

Raw Join claim and MCP connection are separate states. The stable local bridge performs the first authenticated gameplay request before it reports `connected: true`.

## Remote Room MCP protocol

Transport:

```text
POST https://waitloop.run/mcp
Authorization: Bearer <wlseat_...>
X-Waitloop-Room: <room-id>
```

Remote tools:

```text
get_turn()
wait_for_turn(timeoutMs?)
play_move(expectedRevision, moveId)
comment(text)
yield_to_bot()
take_control()
```

### `wait_for_turn`

Input:

```json
{
  "timeoutMs": 25000
}
```

`timeoutMs` is optional, integer, minimum 1000 and maximum 25000.

Result text decodes to:

```json
{
  "version": 1,
  "reason": "your_turn | game_finished | room_paused | waiting_for_players | controller_changed | timeout",
  "waitedMs": 1234,
  "stillWaiting": true,
  "snapshot": {}
}
```

`stillWaiting` appears for transport timeout. Actionable Room states return immediately. Transport timeout never mutates game state or authorizes fallback.

The MCP HTTP request signal is also part of the transport contract for waiting. If the client cancels/disconnects the request, the wait loop aborts promptly; cancellation produces no game mutation and does not become a synthetic `timeout` result.

### Mutations

`play_move` requires `seat:play`, active Controller, authoritative turn, exact revision, and a server-generated move ID.

`comment` is a bounded side channel and does not increment game revision.

`yield_to_bot` is valid only for an Actor that owns and controls its Seat. `take_control` is valid for the reconnected Seat owner. Both preserve Seat identity/game state; reconnect alone does not change Controller.

## Stable local MCP protocol

Transport is local stdio:

```text
command: waitloop
args: ["mcp"]
```

Install helpers:

```text
waitloop mcp install codex
waitloop mcp install claude-code
```

Local tools:

```text
create_room()
join_room(code)
get_active_room()
leave_room()
get_turn()
wait_for_turn(timeoutMs?)
play_move(expectedRevision, moveId)
comment(text)
yield_to_bot()
take_control()
```

Control tools reuse HTTP; gameplay tools proxy remote MCP. The local server returns safe metadata/snapshots only. Raw credentials remain in private local cache.

### Stdio negotiation

The stable command accepts:

```text
MCP 2026-07-28  server/discover
legacy clients  initialize for supported protocol versions
```

The bridge does not blindly echo unsupported legacy versions; it negotiates within its supported legacy set.

### In-flight request cancellation

Each JSON-RPC request ID has an independent local cancellation scope. A notification:

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/cancelled",
  "params": { "requestId": 7 }
}
```

aborts the matching in-flight request when present. The matching `AbortSignal` is passed into proxied Room HTTP/MCP fetches. After cancellation, the local bridge suppresses any late/stale result for that request ID.

A long `wait_for_turn` therefore does not prevent the bridge from reading cancellation or unrelated requests. Duplicate concurrent request IDs are rejected.

Active Room state:

```json
{
  "version": 1,
  "code": "WL-...",
  "serverUrl": "https://waitloop.run",
  "updatedAt": 0
}
```

This pointer does not contain the bearer token. Credential material remains in the corresponding private Join cache entry.

`leave_room` clears this pointer only and reports `credentialRevoked:false`.

## Anonymous browser Actor identity

Browser creation may issue:

```text
actorId    actor_...
credential wla_...
```

The pair is transported in an HttpOnly cookie. Only the credential digest is stored per Room. Actor ID alone never authenticates. The credential may mint a fresh Room viewer credential while the Room remains active.

## Revisions and errors

Relevant server/game error codes include:

```text
stale_revision
not_active_controller
not_seat_owner
invalid_controller
controller_not_ready
room_manage_forbidden
invalid_actor_credential
invalid_wait_timeout
rate_limited
join_expired
join_already_claimed
```

Local bridge classification additionally uses codes such as:

```text
no_active_room
request_cancelled
network_unavailable
remote_unavailable
room_auth_failed
room_not_found
room_expired
invalid_mcp_response
```

HTTP errors remain versioned JSON. Remote/local MCP tool failures are returned as MCP tool errors with structured JSON text.

When known, a local tool error may also include:

```json
{
  "error": {
    "code": "network_unavailable",
    "message": "...",
    "nextAction": "...",
    "retrySafe": true
  }
}
```

`retrySafe` is conservative. Read-only operations can be marked safe to repeat. Mutating operations are not marked retry-safe after cancellation/network uncertainty; clients should obtain a fresh snapshot before deciding whether to replay.

## Continuation boundary

MCP request/response transport cannot resume an Agent after the Agent sends a final response. Continuous-play intent must keep the current Agent run alive and repeat `wait_for_turn -> play_move` until its requested stopping condition.

The implementation and public Agent surfaces must change in the same PR as protocol behavior.
