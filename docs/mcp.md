# MCP boundaries

Waitloop has three MCP-facing layers with distinct responsibilities:

```text
local stdio MCP (`waitloop mcp`)
  stable Agent-facing bridge
  control-plane convenience
  Agent gameplay proxy
  Human MCP App host

MCP App (`ui://waitloop/doudizhu/v1`)
  Human-operated sandbox UI
  App-only calls back into the local bridge

remote HTTP MCP (`https://waitloop.run/mcp`)
  one already-authorized Room Actor binding
  Agent gameplay and Room observation only
```

Lifecycle detection is separate from all three layers and uses separate credentials.

## Stable local bridge

Install once for supported harnesses:

```bash
waitloop mcp install codex
waitloop mcp install claude-code
```

Stable runtime command:

```text
waitloop mcp
```

The bridge uses the official MCP v2 stdio server and supports legacy 2025-era clients and 2026-07-28 clients through the same command.

### Model-visible tools

```text
open_game(gameId?, mode?, roomId?)
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

### MCP App-only tools

```text
ui_get_game(roomId, uiToken)
ui_play_cards(roomId, uiToken, expectedRevision, cardIds)
ui_pass(roomId, uiToken, expectedRevision)
ui_hint(roomId, uiToken, expectedRevision, cursor?)
```

The `ui_*` tools are marked App-only in MCP metadata but still require the independent private `uiToken`. Host visibility is defense in depth, not authorization.

## Human UI versus Agent-owned play

The entry tools intentionally create different ownership:

```text
open_game()
  existing Human `bots` Room
  Human owns and controls seat-1
  Human clicks the MCP App

create_room()
  existing `agent-bots` Room
  connected Agent owns and controls seat-1
  Agent uses get_turn / wait_for_turn / play_move
```

The embedded UI must never impersonate an Agent Actor or receive an Agent bearer credential. The model must not call Human App-only tools without the Host-delivered App capability.

## MCP App resource

`open_game()` links its result to:

```text
URI       ui://waitloop/doudizhu/v1
MIME      text/html;profile=mcp-app
protocol  2026-01-26
```

Tool metadata includes both:

```text
_meta.ui.resourceUri
_meta["ui/resourceUri"]
```

The self-contained resource uses MCP Apps messages for initialization, tool-result delivery, Host-context changes, size reporting, display-mode requests, external-link requests, teardown, and `tools/call`.

The App supports card selection, play, pass, hint, clear, refresh, inline rendering, and fullscreen where the Host advertises it. Compact activity shows the latest four authoritative history rows without an internal scrollbar; `current trick` remains separate.

## Host capability boundary

A compatible Host must:

1. preserve MCP Apps tool metadata;
2. read the linked `ui://` resource;
3. render `text/html;profile=mcp-app` in a sandbox;
4. forward the initial result, including result `_meta`, to the App;
5. proxy App `tools/call` requests to the MCP server.

A Host can show safe JSON to the model and render the App to the Human simultaneously. Visible structured output is not evidence that rendering failed. Browser fallback is appropriate only after an actual App render/action failure, an App error, or explicit Human confirmation that inline controls are absent.

The fallback URL starts a separate standalone game. Waitloop does not put private Human credentials in a transferable URL, so it does not resume the inline Room.

## Private Human session custody

`open_game()` reuses the existing Human `bots` Room endpoint. The Worker returns the normal HttpOnly Human credentials:

```text
wl_actor
wl_room_<room>
```

The local bridge stores them under:

```text
~/.waitloop/app-rooms/<sha256(room-id)>.json
```

Each record also contains a high-entropy:

```text
wlui_<64 hex characters>
```

The App capability is delivered only through:

```text
tool result _meta["waitloop/uiToken"]
```

It is absent from model-visible text, `structuredContent`, tool descriptions, resource source, and model-visible errors. Every App-only call supplies the Room ID and capability; the bridge performs constant-time verification before accessing Human credentials.

The App contains no concrete credential and makes no direct credentialed fetch, XHR, or WebSocket request. Traffic remains:

```text
MCP App
  -> Host tools/call proxy
  -> local waitloop mcp
  -> existing Human Room HTTP API
  -> GameRoom Durable Object
```

## Human MCP App request budget

The Human-vs-bots App is response-driven:

```text
open_game result
  initial authoritative snapshot

ui_play_cards / ui_pass result
  authoritative snapshot after Human action and synchronous Bot automation

ui_hint result
  read-only suggestion
```

There is no periodic state-refresh timer. `ui_get_game` is used only for explicit refresh, reopen, one-shot focus/visibility recovery, stale-revision recovery, and uncertain mutation-result recovery. Reads are single-flight. An idle mounted App generates zero recurring Worker and Durable Object reads.

Multiple local views are not kept coherent through permanent polling. The acting view renders its mutation result immediately; another view refreshes when it becomes active or participates. A future authorized Room subscription may distribute semantic updates to all related views.

## Existing service reuse

The local bridge does not duplicate Room/game business logic:

- `open_game` calls existing Human Room creation and stores Human credentials locally;
- `ui_*` tools proxy existing Human snapshot/play/pass/hint endpoints;
- `create_room` calls the existing headless Room endpoint and claims Join;
- `join_room` calls the existing Join endpoint;
- Agent gameplay and observation tools proxy existing remote Room MCP;
- authorization, private projection, revision checks, and move legality remain server-side.

## Game revision versus Room event sequence

```text
revision
  game mutation concurrency
  used by play/pass expectedRevision

roomSeq
  monotonic semantic Room event cursor
  used by observers
```

`roomSeq` advances for client-visible semantic changes such as game actions, comments, Controller transitions, Room phase changes, Join/connection transitions, and meaningful Actor status changes. Heartbeat-only timestamps and credential-only writes do not advance it.

## Efficient Agent waiting

### `wait_for_turn(timeoutMs?)`

This is a Controller/actionable-turn primitive. It returns on:

```text
your_turn
game_finished
waiting_for_players
room_paused
controller_changed
timeout
```

The transport bound is 1–25 seconds and the current implementation re-reads the authenticated snapshot at a bounded interval. Timeout or cancellation never auto-passes, auto-plays, changes Controller, or creates a competitive clock.

An Advisor bound to a Human-controlled Seat may receive `controller_changed` immediately. That is expected; it is not a generic Room update subscription.

### `wait_for_room_update(afterRoomSeq, timeoutMs?)`

This read-only tool waits for the authenticated projection `roomSeq` to advance or for the Room to finish. It is valid for Controllers and Advisors and does not grant `seat:play`.

```text
afterRoomSeq = 0
  return current snapshot immediately

cursor behind current roomSeq
  return room_updated

Room finished
  return game_finished

bounded wait expires
  return timeout

cursor ahead of current roomSeq
  return room_seq_ahead; recover with get_turn
```

Repeating the tool supports observation only while the current Agent run remains active. It is not a background scheduler and cannot wake an Agent after final response.

## Future push subscription boundary

A future push connection must preserve private projection identity. Reuse keys must include at least:

```text
server origin
+ Room ID
+ authorized principal or credential scope
+ projection type and version
```

A connection must never be keyed only by Room ID because Human, Controller, Advisor, Agent, and future spectator projections can contain different private data.

The existing browser viewer WebSocket route remains intentionally disabled. Current GameRoom WebSocket output is actor-specific Agent projection, not the reduced Human snapshot protocol. Human subscription requires explicit viewer authentication, Human projection, reconnect-to-full-snapshot behavior, `roomSeq` cursor recovery, cancellation, and lifecycle cleanup.

## Cancellation semantics

Cancellation propagates only through operations where abandoning the response cannot create an ambiguous mutation result:

```text
get_active_room
get_turn
wait_for_turn
wait_for_room_update
ui_get_game
ui_hint
```

Mutation-capable operations are not network-aborted mid-flight:

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

After an uncertain mutation transport failure, clients refresh authoritative state before retrying.

## Active Agent Room context

`waitloop join`, `join_room`, and `create_room` select one active credential-backed Agent Room. The active pointer contains Join/server context, not a second secret copy.

```text
get_active_room()
  load cached credential
  authenticate remote Actor
  return safe metadata and snapshot

leave_room()
  clear local active selection only
  do not revoke credential
  do not mutate Room
```

Human MCP App sessions are separate and reopen through `open_game(roomId)`.

## Remote authentication and identity

Remote MCP requests carry:

```text
Authorization: Bearer <wlseat_...>
X-Waitloop-Room: <room-id>
```

Room ID, Seat ID, and Actor ID are identifiers, not credentials. The bearer credential authorizes one Room Actor binding and only its digest is stored in Room state.

The remote endpoint does not expose `open_game` or Human `ui_*` tools because it cannot safely own local Human cookies and App capability.

## Join, connect, and reconnect

```text
Join capability
  one-time
  about 20 minutes

Room Actor credential
  reconnectable while Room is active
  Room currently lasts about 24 hours
```

Join claim means a credential exists. The first authenticated remote MCP request establishes connected runtime presence. Local `join_room` and `create_room` perform that request before returning `connected: true`.

Reconnect updates presence only. It never silently changes `activeControllerActorId` or steals control from a temporary Bot.

## Remote Agent tools

```text
get_turn()
wait_for_turn(timeoutMs?)
wait_for_room_update(afterRoomSeq, timeoutMs?)
play_move(expectedRevision, moveId)
comment(text)
yield_to_bot()
take_control()
```

`play_move` succeeds only when the Actor has `seat:play`, is active Controller, owns the authoritative turn, supplies the current revision, and chooses a server-generated legal move ID.

`comment` is a bounded side channel. It advances `roomSeq` but never changes game revision, turn order, or legality.

`yield_to_bot` and `take_control` preserve Seat ID, owner, hand, role, and history. In fully headless `agent-bots`, yielding `seat-1` can leave all Seats under Bot control and allow the game to finish before reconnect.

## Agent-run continuation

MCP is request/response participation. It cannot wake an Agent after final response.

```text
connect or verify
  join_room / get_turn
  report

Agent plays until finished
  keep current run active
  wait_for_turn
  play_move when actionable
  repeat bounded waits
  stop at requested condition

Advisor observes during current run
  remember roomSeq
  wait_for_room_update
  comment when useful
  repeat while run remains active

Human plays inline
  open_game
  Host renders App
  Human clicks controls
```

## Security invariants

- model-visible results never contain Agent bearer credentials, Human cookies, or the `wlui_` capability;
- result `_meta` carries App-private capability only to the embedded UI;
- App-only Human tools independently require the capability;
- local errors redact credential-shaped values;
- the App performs no direct credentialed network request;
- remote Actor authentication occurs before Agent tool execution;
- Human cookie authorization occurs before Human mutation execution;
- IDs never substitute for credentials;
- stale, illegal, or non-controller moves are rejected server-side;
- Advisors receive private state only for their explicitly bound Seat;
- lifecycle, Agent Room, Human Room, and App capabilities remain separate scopes;
- cancellation of read/wait operations never mutates game state;
- mutation-capable tools are not abandoned under a false non-execution assumption.

See [`security.md`](security.md), [`protocol.md`](protocol.md), [`architecture.md`](architecture.md), and [`game-system.md`](game-system.md).
