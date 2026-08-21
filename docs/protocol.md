# Protocol

Waitloop uses small versioned protocols so vendor-specific coding-agent details stay outside core runtime and clients cannot bypass game authorization.

## Lifecycle protocol

```text
idle | running | waiting | completed | failed
```

Lifecycle events contain no prompt/source/repository/cwd/transcript/tool/assistant/native-session payloads. Lifecycle credentials and all game/UI credentials are separate.

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

Human snapshots remove exhaustive machine `legalMoves[]` and expose constrained Human actions in `controls`.

The Human MCP App receives the same Human projection as standalone Web. The App capability changes transport authorization only; it does not widen hidden information.

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

HTTP remains the authoritative server control/Human protocol used by Web, CLI, local MCP, MCP App proxy, and advanced raw clients. Clients do not duplicate game logic.

```text
mode:"bots"
  Human seat-1 + two deterministic Bots
  used by standalone Web and local open_game MCP App facade

mode:"agent-bots"
  connected Agent seat-1 + two deterministic Bots
  returns a Join code
```

## Join protocol

```text
GET  /api/v1/join/<join-code>
POST /api/v1/join/<join-code>/claim
GET  /join/<join-code>
```

Current semantics:

```text
Join expires about 20 minutes
Join issues one room Agent Actor credential
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

Raw Join claim and MCP connection are separate states. The stable local bridge performs the first authenticated Agent gameplay request before reporting `connected: true`.

Human `open_game` does not use Join. It uses the ordinary Human Room creation response and locally retains the returned Human cookies.

## Remote Room MCP protocol

Transport:

```text
POST https://waitloop.run/mcp
Authorization: Bearer <wlseat_...>
X-Waitloop-Room: <room-id>
```

Remote Agent tools:

```text
get_turn()
wait_for_turn(timeoutMs?)
play_move(expectedRevision, moveId)
comment(text)
yield_to_bot()
take_control()
```

Remote Room MCP does not expose `open_game` or Human `ui_*` tools.

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

`stillWaiting` appears for transport timeout. Actionable Room states return immediately. Timeout never mutates game state or authorizes fallback.

### Agent mutations

`play_move` requires `seat:play`, active Controller, authoritative turn, exact revision, and a server-generated move ID.

`comment` is a bounded side channel and does not increment game revision.

`yield_to_bot` is valid only for an Actor that owns and controls its Seat. `take_control` is valid for the reconnected Seat owner. Both preserve Seat identity/game state; reconnect alone does not change Controller.

## Stable local MCP protocol

Transport:

```text
command: waitloop
args: ["mcp"]
```

Install helpers:

```text
waitloop mcp install codex
waitloop mcp install claude-code
```

The server supports legacy 2025-era and 2026-07-28 MCP clients from the same official v2 stdio entry.

### Model-visible tools

```text
open_game(gameId?, mode?, roomId?)
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

`open_game` starts/reopens Human operation. `create_room` remains Agent-owned play.

### MCP App-only tools

```text
ui_get_game(roomId, uiToken)
ui_play_cards(roomId, uiToken, expectedRevision, cardIds)
ui_pass(roomId, uiToken, expectedRevision)
ui_hint(roomId, uiToken, expectedRevision, cursor?)
```

They declare:

```json
{
  "ui": {
    "resourceUri": "ui://waitloop/doudizhu/v1",
    "visibility": ["app"]
  }
}
```

The `uiToken` schema is:

```text
^wlui_[a-f0-9]{64}$
```

Visibility is not sufficient authorization; the local bridge validates the stored capability.

## MCP App resource protocol

Resource:

```text
URI       ui://waitloop/doudizhu/v1
MIME      text/html;profile=mcp-app
version   2026-01-26
```

`open_game` tool metadata includes:

```text
_meta.ui.resourceUri = ui://waitloop/doudizhu/v1
_meta["ui/resourceUri"] = ui://waitloop/doudizhu/v1
_meta.ui.visibility = ["model", "app"]
```

The resource supports the following MCP Apps messages:

```text
App -> Host
  ui/initialize
  ui/notifications/initialized
  ui/notifications/size-changed
  ui/request-display-mode
  ui/open-link
  tools/call

Host -> App
  ui/notifications/tool-result
  ui/notifications/host-context-changed
  ui/resource-teardown
```

The App advertises inline/fullscreen display modes. Fullscreen remains Host-controlled.

## Human open-game result protocol

Safe `open_game` text/structured content:

```json
{
  "version": 1,
  "kind": "waitloop.mcp-app.game",
  "uiVersion": 1,
  "gameId": "doudizhu",
  "mode": "human-bots",
  "roomId": "room-...",
  "snapshot": {},
  "fallback": {
    "inlineUiRequired": true,
    "webUrl": "https://waitloop.run/game.html",
    "sameRoom": false,
    "message": "..."
  }
}
```

Private result metadata:

```json
{
  "waitloop/uiToken": "wlui_<64 hex>"
}
```

The token appears only in result `_meta`. It must not appear in text or `structuredContent`.

The safe payload is duplicated in text and `structuredContent` because some Hosts may omit structured content while still rendering a resource.

`open_game({roomId})` reopens a still-valid local Human session, refreshes its safe snapshot, and emits the existing private App capability through result metadata.

## Human app-only calls

### `ui_get_game`

Read-only. Loads the private local Human session, verifies `uiToken`, sends Human cookies to `GET /api/v1/rooms/:roomId`, and returns safe snapshot payload.

### `ui_play_cards`

Mutation input:

```json
{
  "roomId": "room-...",
  "uiToken": "wlui_...",
  "expectedRevision": 4,
  "cardIds": ["..."]
}
```

Requires 1–20 unique bounded card IDs. Server validates Human credential, authoritative turn, exact revision, selected cards, and legal pattern.

### `ui_pass`

Requires Room ID, App capability, and exact revision. Server decides whether passing is legal.

### `ui_hint`

Read-only from a game-state mutation perspective. Requires Room ID, App capability, revision, and optional non-negative cursor. Returns a legal card selection hint plus refreshed Human snapshot.

## Local Human session record

Private local record:

```json
{
  "version": 1,
  "roomId": "room-...",
  "serverUrl": "https://waitloop.run",
  "cookieHeader": "wl_actor=...; wl_room_...=...",
  "uiToken": "wlui_...",
  "createdAt": 0,
  "expiresAt": 0
}
```

File name is a SHA-256-derived value rather than raw Room ID. This record is never a model-visible protocol.

## Agent active Room pointer

```json
{
  "version": 1,
  "code": "WL-...",
  "serverUrl": "https://waitloop.run",
  "updatedAt": 0
}
```

This pointer does not contain Agent bearer token. Credential material remains in the private Join cache entry.

`leave_room` clears this Agent pointer only and reports `credentialRevoked:false`.

## Anonymous Human Actor identity

Human Room creation may issue:

```text
actorId    actor_...
credential wla_...
```

Standalone Web transports it in an HttpOnly cookie. Local MCP App bridge captures the same cookie from `Set-Cookie` and stores it privately. Only credential digest is stored per Room. Actor ID alone never authenticates.

## Cancellation protocol

Safe cancellation-propagating operations:

```text
get_active_room
get_turn
wait_for_turn
ui_get_game
ui_hint
```

Mutation-capable operations are not network-aborted under a false non-execution assumption:

```text
open_game create
create_room
join_room
leave_room
play_move
comment
yield_to_bot
take_control
ui_play_cards
ui_pass
```

## Revisions and errors

Relevant server/local error codes include:

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
interactive_room_missing
interactive_ui_unauthorized
network_unavailable
cancelled
```

HTTP errors remain versioned JSON. Remote/local MCP failures are MCP tool errors with structured JSON text. Credential-shaped values are redacted.

## Continuation boundary

MCP request/response cannot resume an Agent after final response. Continuous Agent play keeps the current run alive and repeats `wait_for_turn -> play_move` until the requested stopping condition.

Human MCP App interaction persists only while the Host keeps the App iframe/tool bridge available. It does not imply the Agent run remains active.

Implementation and public Agent surfaces must change together with protocol behavior.
