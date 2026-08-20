# MCP boundaries

Waitloop now has two MCP layers with distinct responsibilities:

```text
local stdio MCP (`waitloop mcp`)
  = stable Agent-facing bridge
  = control-plane convenience + gameplay proxy

remote HTTP MCP (`https://waitloop.run/mcp`)
  = one already-authorized Room Actor binding
  = gameplay only
```

Neither layer performs coding-agent lifecycle detection. Lifecycle hooks remain a separate integration and credential scope.

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

It exposes:

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

The local bridge does not duplicate Room/game business logic:

- `create_room` calls the existing Room HTTP endpoint, then claims Join;
- `join_room` calls the existing Join HTTP endpoint;
- gameplay/control tools proxy to the existing remote Room MCP;
- authorization and legal-move validation remain server-side.

Room credentials are read from private `~/.waitloop/joins` state and never returned through model-visible local MCP tools.

## Active Room context

`waitloop join`, `join_room`, and `create_room` select one active credential-backed Room. The active pointer contains Join code/server context, not a second secret copy.

```text
get_active_room()
```

loads the cached credential, authenticates the remote Room Actor, and returns safe metadata/snapshot.

```text
leave_room()
```

clears only local active selection. It does not revoke the remote credential or mutate the Room, preserving explicit reconnect until Room expiry.

## Remote authentication and identity

```text
Room ID    routing context
Seat ID    stable room-scoped game position
Actor ID   runtime identity
credential authorization secret
```

Remote MCP requests carry:

```text
Authorization: Bearer <wlseat_...>
X-Waitloop-Room: <room-id>
```

IDs never substitute for credentials. The historical `wlseat_` prefix authorizes one Room Actor binding. Waitloop stores only its digest in Room state.

## Join / connect / reconnect

A Join code currently lasts about 20 minutes and is one-time. The claimed Actor credential remains reconnectable while the Room is active, currently about 24 hours.

```text
raw Join claim
  -> credential exists
  -> Actor connecting

first authenticated remote MCP request
  -> Actor connected
```

The local `join_room` and `create_room` tools perform that first authenticated request before returning `connected: true`. Raw clients must preserve the distinction themselves.

Every authenticated MCP request refreshes presence. Reconnection never silently changes `activeControllerActorId`.

## Remote tool surface

```text
get_turn()
wait_for_turn(timeoutMs?)
play_move(expectedRevision, moveId)
comment(text)
yield_to_bot()
take_control()
```

### `get_turn()`

Returns the private projection of the explicitly bound Seat plus public Room state, Actor/Seat/binding metadata, capabilities, Controller, revision, and server-generated legal moves.

An Advisor may see only the private Seat it was explicitly bound to.

### `wait_for_turn(timeoutMs?)`

The server re-reads the authenticated Actor snapshot at a bounded interval and returns when:

```text
your_turn
game_finished
waiting_for_players
room_paused
controller_changed
timeout
```

Current bounds:

```text
default timeout 25 seconds
maximum timeout 25 seconds
minimum timeout 1 second
poll interval about 750 ms
```

This timeout is transport protection only. It does not:

```text
auto-pass
auto-play
replace a slow Agent
change Controller
create a ranked/competitive clock
```

The client can call `wait_for_turn` again while the current Agent run remains active.

### `play_move(expectedRevision, moveId)`

Succeeds only when the Actor has `seat:play`, is active Controller, owns the authoritative turn, supplies the current revision, and selects a server-generated legal move ID.

### `comment(text)`

Bounded side channel. It never changes game state, revision, turn, or legal moves.

### `yield_to_bot()` / `take_control()`

A connected Seat owner may explicitly replace itself as Controller with a temporary deterministic Bot, then later reconnect and explicitly reclaim control.

Preserved throughout:

```text
Seat ID
ownerActorId
hand
role
history
```

Reconnect alone never calls `take_control`.

## Agent-run continuation

MCP is passive request/response participation. It cannot wake Codex/Claude/Cursor after the Agent has returned a final reply.

```text
connect/check
  -> join_room/get_turn
  -> report

play until finished
  -> keep current Agent run alive
  -> wait_for_turn
  -> play_move when your_turn
  -> repeat timeout waits
  -> stop only at game_finished or user-requested condition
```

The local bridge solves stable configuration and credential routing. `wait_for_turn` solves efficient in-run waiting. Neither is a background scheduler for ended Agent runs.

## Headless use

Preferred:

```text
create_room({gameId:"doudizhu", mode:"agent-bots"})
```

Equivalent CLI:

```bash
waitloop room create
```

Advanced raw fallback remains:

```http
POST https://waitloop.run/api/v1/rooms
Content-Type: application/json

{"version":1,"gameId":"doudizhu","mode":"agent-bots"}
```

The remote Room MCP itself remains room-scoped and therefore does not expose `create_room`; that tool belongs to the local control bridge and reuses HTTP.

## Security invariants

- local tools never return bearer credentials;
- remote Actor authentication occurs before tool execution;
- Room/Actor/Seat identity is transport-resolved, not model-supplied gameplay arguments;
- stale/non-controller/illegal moves are rejected server-side;
- Advisors see private state only for their bound Seat;
- Room credentials never authorize lifecycle ingestion;
- Join and Room expiry are separate;
- rate limits are abuse controls, not automatic timing or accounting;
- `yield_to_bot` and `take_control` are explicit owner-control transitions.

See [`security.md`](security.md), [`protocol.md`](protocol.md), [`architecture.md`](architecture.md), and [`game-system.md`](game-system.md).
