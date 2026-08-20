# MCP game boundary

Waitloop exposes a fixed remote MCP endpoint at `/mcp` for one temporary room-scoped **Actor binding**.

MCP is intentionally not lifecycle detection. Lifecycle hooks report coding-agent work state; MCP lets an already-authorized game Actor inspect/play/comment within one room.

## Seat vs Actor

MCP authenticates an Actor, not an abstract game rule player ID.

```text
Seat = game player position
Actor = connected runtime identity
Binding = Actor -> Seat relationship
```

A connected Actor may be:

- `controller` of its own Seat;
- `advisor` bound to another Actor's Seat.

Both receive only the private projection of their explicitly bound Seat. An advisor does not receive `seat:play` until the Seat owner delegates active control.

## Onboarding and headless use

Join code paths are equivalent entry methods:

```text
waitloop join <code>
POST /api/v1/join/<code>/claim
https://waitloop.run/join/<code>
```

The Web page is optional. Agents can create a headless room directly:

```http
POST /api/v1/rooms
Content-Type: application/json

{"version":1,"gameId":"doudizhu","mode":"agent-bots"}
```

Then claim the returned code and connect MCP. `companion-agent` creates an advisor bound to the Human Seat; `connected-agent` creates an independent Agent Seat.

## Join/Actor lifecycle

```text
room created
  -> connected Actor waiting
  -> join code claimed
  -> wlseat_... Actor credential issued
  -> Actor connecting
  -> first authenticated MCP request
  -> Actor connected
  -> room begins playing
```

The historical token prefix remains `wlseat_` for compatibility, but its durable meaning is now a room-scoped **Actor capability**. The Actor's Join response includes `actorId`, `seatId`, and `relation`.

## Authentication

Every MCP request carries:

```text
Authorization: Bearer <wlseat_...>
X-Waitloop-Room: <room-id>
```

The server stores only a digest of the raw credential.

Room ID and credential are transport/auth context, never model-visible tool arguments. The transport resolves the authenticated Actor and its bound Seat before tools execute.

## Tools

Current surface:

```text
get_turn()
play_move(expectedRevision, moveId)
comment(text)
```

### `get_turn()`

Returns the Actor's room snapshot, including:

- `viewerActorId` and `viewerSeatId`;
- Actor/Seat/binding metadata;
- capability list;
- private hand/state of the explicitly bound Seat;
- public player/card counts and history;
- current Controller;
- room revision;
- server-generated legal move IDs when relevant.

An advisor is intentionally allowed to inspect its bound Seat's hand/legal options. It cannot use this mechanism to request a different unrelated Seat's private view.

### `play_move(expectedRevision, moveId)`

Input:

```json
{
  "expectedRevision": 12,
  "moveId": "play:..."
}
```

A move succeeds only when all are true:

- this Actor has `seat:play`;
- this Actor is the bound Seat's active Controller;
- it is that Seat's authoritative turn;
- the revision is current;
- the move ID is server-generated and legal.

An advisor that has not been delegated control receives `not_active_controller` even if it can see a legal move list.

### `comment(text)`

Input:

```json
{"text":"I would probably pass here."}
```

Comments are a room side channel for advice/reactions. They do not mutate:

- game state;
- game revision;
- turn order;
- legal moves.

The current input is trimmed and bounded to 280 characters. Companions should be useful rather than noisy.

## Controller delegation

Controller changes are control-plane operations, currently exposed to the Human Seat owner through the room API/Web UI.

```text
Seat owner: Human
Advisor: connected Agent
activeControllerActorId: Human

Human delegates
  -> activeControllerActorId: Agent
  -> Human retains private view but browser play controls disable
  -> Agent play_move becomes authorized

Human takes back control
  -> activeControllerActorId: Human
```

Changing Controller never changes the underlying Seat/hand/role/history.

## Raw MCP configuration

Equivalent configuration:

```json
{
  "mcpServers": {
    "waitloop": {
      "type": "http",
      "url": "https://waitloop.run/mcp",
      "headers": {
        "Authorization": "Bearer ${WAITLOOP_ACTOR_TOKEN}",
        "X-Waitloop-Room": "${WAITLOOP_ROOM_ID}"
      }
    }
  }
}
```

Do not commit, log, put in prompts, or persist the raw room credential beyond its useful room lifetime.

## Why identity is outside tool arguments

This is intentionally not the API:

```text
get_turn(roomId, playerId, token)
play_move(roomId, playerId, token, ...)
```

The model sees only the constrained gameplay schema. Room/Actor/Seat identity is resolved by the authenticated transport, which prevents model argument substitution from selecting another private view.

## CLI relationship

```bash
waitloop join WL-7K4P9Q2MZX
waitloop join WL-7K4P9Q2MZX --json
```

The CLI performs the same Join API exchange and prints/caches the temporary MCP configuration. It does not implement game authorization or rules itself.

## Timing

The first authenticated MCP request is readiness. Casual connected Actors have no hard game timeout; elapsed time may be shown but does not authorize forced moves/passes.

A future Arena/benchmark policy may add hard timing separately.

## Security invariants

- browser `Origin` is restricted for MCP HTTP requests;
- Actor auth happens before MCP tool execution;
- move/comment handlers re-check room-scoped credential/capability;
- an advisor can see only the private Seat explicitly granted by its binding;
- game Actor credentials are narrower than lifecycle device credentials and are never reused for lifecycle ingestion;
- room IDs are routing/context identifiers, not authorization secrets.

See [`security.md`](security.md) and [`game-system.md`](game-system.md).
