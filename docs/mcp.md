# MCP boundaries

Waitloop has three MCP-facing layers with distinct responsibilities:

```text
local stdio MCP (`waitloop mcp`)
  = stable Agent-facing bridge
  = control-plane convenience + gameplay proxy + Human MCP App host

MCP App (`ui://waitloop/doudizhu/v1`)
  = Human-operated sandbox UI delivered by the local bridge
  = app-only calls back into the local bridge

remote HTTP MCP (`https://waitloop.run/mcp`)
  = one already-authorized Room Actor binding
  = Agent gameplay only
```

None of these performs coding-agent lifecycle detection. Lifecycle hooks remain a separate integration and credential scope.

## Stable local bridge

Install once for supported harnesses:

```bash
waitloop mcp install codex
waitloop mcp install claude-code
```

The stable command is always:

```text
waitloop mcp
```

The bridge uses the official MCP v2 stdio server entry and serves both legacy 2025-era clients and 2026-07-28 clients from that command. Protocol negotiation, concurrent dispatch, and MCP cancellation are transport concerns rather than hand-written Waitloop JSON-RPC behavior.

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

### App-only tools

```text
ui_get_game(roomId, uiToken)
ui_play_cards(roomId, uiToken, expectedRevision, cardIds)
ui_pass(roomId, uiToken, expectedRevision)
ui_hint(roomId, uiToken, expectedRevision, cursor?)
```

The `ui_*` tools are marked with:

```json
{
  "ui": {
    "resourceUri": "ui://waitloop/doudizhu/v1",
    "visibility": ["app"]
  }
}
```

They are not part of the normal model tool surface and still require an independent private capability. Host visibility is defense in depth, not authorization.

## Human UI versus Agent-owned play

The two entry tools intentionally create different Actor/Seat ownership:

```text
open_game()
  -> existing Human `bots` Room
  -> Human owns/controllers seat-1
  -> Human clicks the MCP App

create_room()
  -> existing `agent-bots` Room
  -> connected Agent owns/controllers seat-1
  -> Agent calls get_turn/wait_for_turn/play_move
```

`open_game()` must be used when the Human wants to operate the game. `create_room()` must remain Agent-owned and headless. The local bridge must never make the embedded UI impersonate an Agent Actor or expose Agent bearer credentials to the UI.

## MCP App resource

`open_game()` links its tool result to:

```text
URI       ui://waitloop/doudizhu/v1
MIME      text/html;profile=mcp-app
protocol  2026-01-26
```

The tool publishes both current and compatibility metadata:

```text
_meta.ui.resourceUri
_meta["ui/resourceUri"]
```

The resource is one self-contained HTML document. It uses the MCP Apps postMessage protocol for:

```text
ui/initialize
ui/notifications/initialized
ui/notifications/tool-result
ui/notifications/host-context-changed
ui/notifications/size-changed
ui/request-display-mode
ui/open-link
ui/resource-teardown
tools/call
```

The App supports card selection, play, pass, hint, clear, refresh, inline rendering, and fullscreen when the Host advertises it.

The App contains no external script/style dependency and performs no credentialed direct network request. Game traffic is:

```text
MCP App
  -> Host tools/call proxy
  -> local waitloop mcp
  -> existing Human Room HTTP API
  -> GameRoom Durable Object
```

## Host capability boundary

A useful inline experience requires the active Host to:

1. preserve MCP Apps tool metadata;
2. read the `ui://` resource;
3. render `text/html;profile=mcp-app` in a sandbox;
4. forward the initial tool result, including result `_meta`, to the App;
5. proxy App `tools/call` requests to the MCP server.

Waitloop does not assume that every Codex, Claude, Cursor, terminal, or desktop surface currently provides all five behaviors.

When a Host cannot render or operate the App, `open_game()` still returns a safe textual/structured snapshot plus fallback guidance. The external fallback:

```text
https://waitloop.run/game.html
```

starts a **separate** browser-controlled game. It does not resume the private inline Room because Waitloop does not place Human Room credentials in a transferable URL.

`create_room()` remains the fallback when the Agent, rather than the Human, should play.

## Private Human session custody

`open_game()` reuses the existing Human `bots` Room endpoint. The Worker returns two HttpOnly credentials:

```text
wl_actor   anonymous Human Actor credential
wl_room_*  private Room viewer credential
```

The local bridge captures those cookies from `Set-Cookie` and stores them privately under:

```text
~/.waitloop/app-rooms/<sha256(room-id)>.json
```

The directory/file modes are created as private local state. The safe tool result contains the Human snapshot, Room ID, and fallback description, but never contains either cookie.

For each interactive Room, the bridge also creates:

```text
wlui_<64 hex characters>
```

This App capability is stored with the private session and delivered to the embedded App only through:

```text
tool result _meta["waitloop/uiToken"]
```

It is absent from:

```text
content[].text
structuredContent
model-visible errors
tool descriptions
ui:// resource source
```

Every `ui_*` call must supply both `roomId` and the exact `uiToken`. The bridge verifies the token with a constant-time comparison before accessing the Human Room cookies. Therefore, even a Host that mistakenly exposes app-only tool names to the model does not give the model Human mutation authority.

`open_game({roomId})` reopens a still-valid local interactive session and emits a fresh tool result carrying the existing private App capability in result metadata.

Interactive Human Room state is separate from the Agent active-Room pointer under `~/.waitloop/joins`.

## Local bridge reuse of existing services

The bridge does not duplicate Room/game business logic:

- `open_game` calls the existing Human Room HTTP endpoint and stores the returned Human credentials locally;
- `ui_get_game`, `ui_play_cards`, `ui_pass`, and `ui_hint` proxy to the existing Human snapshot/mutation endpoints;
- `create_room` calls the existing headless Room endpoint, then claims Join;
- `join_room` calls the existing Join endpoint;
- Agent gameplay/control tools proxy to existing remote Room MCP;
- authorization, revision, hidden-information projection, and move legality remain server-side.

## Cancellation semantics

Cancellation is limited to operations where abandoning the response cannot create an ambiguous mutation result.

```text
get_active_room / get_turn / wait_for_turn
ui_get_game / ui_hint
  -> MCP handler AbortSignal
  -> local fetch
  -> remote request cancellation
```

`wait_for_turn` additionally stops its server-side polling delay as soon as the request is cancelled.

Mutation-capable operations are not network-aborted mid-flight:

```text
open_game room creation
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

This avoids the unsafe case where the server committed a mutation while the Agent/App believes cancellation guaranteed non-execution. After an uncertain mutation transport failure, refresh current state before retrying.

## Active Agent Room context

`waitloop join`, `join_room`, and `create_room` select one active credential-backed Agent Room. The active pointer contains Join code/server context, not a second secret copy.

```text
get_active_room()
```

loads the cached Agent credential, authenticates the remote Room Actor, and returns safe metadata/snapshot.

```text
leave_room()
```

clears only local Agent active selection. It does not revoke the remote credential or mutate the Room, preserving explicit reconnect until Room expiry.

Human MCP App Rooms are reopened through `open_game(roomId)` and do not change this Agent pointer.

## Remote authentication and identity

```text
Room ID    routing context
Seat ID    stable room-scoped game position (`seat-1`, `seat-2`, `seat-3`)
Actor ID   runtime identity
credential authorization secret
```

Remote MCP requests carry:

```text
Authorization: Bearer <wlseat_...>
X-Waitloop-Room: <room-id>
```

IDs never substitute for credentials. The `wlseat_` credential authorizes one Room Actor binding. Waitloop stores only its digest in Room state.

The remote HTTP MCP does not expose `open_game` or the Human `ui_*` tools. Those require local cookie custody and belong only to the local stdio bridge.

## Join / connect / reconnect

A Join code currently lasts about 20 minutes and is one-time. The claimed Agent credential remains reconnectable while the Room is active, currently about 24 hours.

```text
raw Join claim
  -> credential exists
  -> Actor connecting

first authenticated remote MCP request
  -> Actor connected
```

The local `join_room` and `create_room` tools perform that first authenticated request before returning `connected: true`. Raw clients must preserve the distinction themselves.

Every authenticated remote MCP request refreshes presence. Reconnection never silently changes `activeControllerActorId`.

## Remote Agent tool surface

```text
get_turn()
wait_for_turn(timeoutMs?)
play_move(expectedRevision, moveId)
comment(text)
yield_to_bot()
take_control()
```

### `get_turn()`

Returns the private projection of the explicitly bound Seat plus public Room state, Actor/Seat/binding metadata, capabilities, Controller, revision, and server-generated legal moves. An Advisor may see only the private Seat it was explicitly bound to.

### `wait_for_turn(timeoutMs?)`

The server re-reads the authenticated Agent snapshot at a bounded interval and returns on:

```text
your_turn
game_finished
waiting_for_players
room_paused
controller_changed
timeout
```

Bounds:

```text
default timeout 25 seconds
maximum timeout 25 seconds
minimum timeout 1 second
poll interval about 750 ms
```

Timeout or cancellation does not auto-pass, auto-play, replace a slow Agent, change Controller, or create a competitive clock.

### `play_move(expectedRevision, moveId)`

Succeeds only when the Actor has `seat:play`, is active Controller, owns the authoritative turn, supplies the current revision, and selects a server-generated legal move ID.

### `comment(text)`

Bounded side channel. It never changes game state, revision, turn, or legal moves.

### `yield_to_bot()` / `take_control()`

A connected Seat owner may explicitly replace itself as Controller with a temporary deterministic Bot, then later reconnect and explicitly reclaim control. Seat ID, owner, hand, role, and history are preserved.

In a fully headless `agent-bots` Room, yielding `seat-1` leaves all three Seats under Bot control. The bots may finish the remaining game before reconnect. Yield is an explicit handoff, not a pause primitive.

## Agent-run continuation

MCP is request/response participation. It cannot wake an Agent after the Agent returned a final reply.

```text
connect/check
  -> join_room/get_turn
  -> report

Agent plays until finished
  -> keep current Agent run alive
  -> wait_for_turn
  -> play_move when your_turn
  -> repeat timeout waits
  -> stop at game_finished or user-requested condition

Human plays inline
  -> open_game
  -> Host renders MCP App
  -> Human clicks App controls
```

The local bridge solves stable configuration, credential custody, and UI delivery. `wait_for_turn` solves efficient Agent waiting. Neither is a background scheduler for ended Agent runs.

## Security invariants

- model-visible local results never contain Agent bearer credentials, Human cookies, or the `wlui_` App capability;
- tool-result `_meta` carries the App capability only to the embedded UI;
- app-only Human mutation tools require the capability independently of Host visibility;
- local tool errors redact `wlseat_`, `wlview_`, `wla_`, `wldev_`, and `wlui_` shaped values;
- the MCP App is self-contained and does not make direct credentialed network requests;
- remote Actor authentication occurs before Agent tool execution;
- Human cookie authorization occurs before Human mutation execution;
- Room/Actor/Seat identity never substitutes for a credential;
- stale/non-controller/illegal moves are rejected server-side;
- Advisors see private state only for their bound Seat;
- lifecycle, Agent Room, Human Room, and UI capabilities are separate scopes;
- Join and Room expiry are separate;
- rate limits are abuse controls, not automatic game timing or accounting;
- cancellation of read/wait operations never mutates game state;
- mutation-capable tools are not abandoned mid-flight through propagated network cancellation;
- `yield_to_bot` and `take_control` are explicit owner-control transitions.

See [`security.md`](security.md), [`protocol.md`](protocol.md), [`architecture.md`](architecture.md), and [`game-system.md`](game-system.md).
