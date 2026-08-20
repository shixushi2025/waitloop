# MCP game boundary

Waitloop exposes one fixed remote gameplay endpoint at `/mcp` for a room-scoped **Actor binding**.

MCP is not coding-agent lifecycle detection and is not the current Room creation control plane. HTTP/CLI create/claim/manage Rooms; MCP operates inside an already-authorized Room.

## Authentication and identity

```text
Room ID  = routing context
Seat ID  = stable room-scoped game position
Actor ID = runtime identity
credential = authorization secret
```

New three-player Dou Dizhu Rooms use stable Seat IDs `seat-1`, `seat-2`, and `seat-3`. Those IDs describe game positions only; they never authorize access.

IDs never substitute for credentials.

Every MCP request carries:

```text
Authorization: Bearer <wlseat_...>
X-Waitloop-Room: <room-id>
```

The legacy `wlseat_` prefix authorizes one room-scoped Actor binding. The raw token is stored only by the client; Waitloop stores its digest.

## Join / reconnect

Join paths:

```text
waitloop join <code>
POST /api/v1/join/<code>/claim
https://waitloop.run/join/<code>
```

Current Join code lifetime is about 20 minutes and it can issue one credential. The resulting Actor credential remains reconnectable while the Room remains active (about 24 hours for new Rooms).

The CLI caches the claimed room credential plus `actorId`, `seatId`, relation, and Room expiry under `~/.waitloop/joins`.

Every authenticated MCP request refreshes Actor presence. Reconnecting does not automatically change the Seat Controller.

## Tool surface

```text
get_turn()
play_move(expectedRevision, moveId)
comment(text)
yield_to_bot()
take_control()
```

### `get_turn()`

Returns the private projection of the Actor's explicitly bound Seat plus public Room state, Actor/Seat/binding metadata, capabilities, Controller, revision, and server-generated legal moves.

An Advisor may see the private Seat it was explicitly bound to but never an unrelated Seat.

### `play_move(expectedRevision, moveId)`

Succeeds only if the Actor has `seat:play`, is the active Controller, is acting on the authoritative turn, supplies the current revision, and selects a server-generated legal move ID.

### `comment(text)`

Bounded room comment side channel. It does not mutate game state, game revision, turn, or legal moves.

### `yield_to_bot()`

Available to a connected Actor that owns and currently controls its Seat.

It creates a temporary deterministic Bot Actor bound as Controller of the **same Seat**. It preserves:

```text
Seat ID
ownerActorId
hand
role
history
```

The connected owner is marked away/disconnected in runtime metadata. This is explicit; elapsed Casual time never triggers it automatically.

### `take_control()`

Available to a connected Seat owner after reconnecting. It removes the temporary Bot Actor/binding and restores the owner as active Controller.

Reconnect intentionally does not call this automatically. This prevents a returning client from silently racing the current Controller.

## Headless use

MCP cannot create its own Room because it is room-scoped. Headless Agents first call:

```http
POST https://waitloop.run/api/v1/rooms
Content-Type: application/json

{"version":1,"gameId":"doudizhu","mode":"agent-bots"}
```

then claim Join and use MCP. A future separate control MCP could wrap HTTP if needed, but the current gameplay MCP stays narrow.

## Controller delegation

Human Seat owners may delegate to an Advisor through Room API/Web. That is a control-plane mutation. Once delegated, the same Advisor MCP token gains `seat:play` because server-side `activeControllerActorId` changed.

Temporary Bot fallback uses the same rule: Controller changes; Seat identity does not.

## Timing and rate protection

Casual has no hard turn timeout. Current server safeguards include per-Actor limits for MCP connection/read/move/comment/control operations. Rate limiting protects abuse; it is not accounting and does not authorize automatic moves.

## Security invariants

- Actor authentication occurs before tool execution.
- Room/Actor/Seat identity is transport-resolved, not model-supplied tool arguments.
- stale/non-controller/illegal moves are rejected server-side.
- Advisors see only their bound Seat's private state.
- room Actor credentials never authorize lifecycle ingestion.
- Join expiry and Room expiry are separate.
- cached credential enables reconnect only for the same Actor binding.

See [`security.md`](security.md), [`protocol.md`](protocol.md), and [`game-system.md`](game-system.md).
