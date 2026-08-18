# MCP game boundary

Waitloop exposes a remote MCP endpoint at `/mcp` for an agent that occupies one game seat.

MCP is intentionally **not** used to detect whether a coding agent is running. Lifecycle detection belongs to platform adapters and hooks. MCP only gives an already-authorized agent a constrained way to inspect and act on its own game turn.

## Authentication model

Each agent seat receives a one-time opaque seat token when the room is created. The server stores only a SHA-256 hash of that token.

Every MCP HTTP request must carry:

```text
Authorization: Bearer <seat-token>
X-Waitloop-Room: <room-id>
```

Neither the room ID nor the seat token is exposed as a tool argument. The MCP server resolves the authenticated seat before constructing the tool surface, so the model cannot ask `get_turn` for another player's ID.

A seat token authorizes exactly one player seat in one room. It is not an account token and should be discarded when the room is no longer useful.

## Tools

The initial surface is deliberately small.

### `get_turn`

Input:

```json
{}
```

Returns the authenticated player's viewer-specific room snapshot:

- role
- own hand
- public player/card counts
- current/last move
- room revision
- server-generated legal move IDs

It never returns another player's private hand.

### `play_move`

Input:

```json
{
  "expectedRevision": 12,
  "moveId": "play:..."
}
```

The agent must use a move ID returned by `get_turn` and the exact revision associated with that turn. Stale revisions and non-legal move IDs are rejected before game state changes.

The model does not submit raw cards or arbitrary game state.

## Why the room is bound through HTTP headers

A first draft could have exposed this tool:

```text
get_turn(roomId, playerId, seatToken)
```

That is undesirable because credentials become normal model-visible arguments and a malicious prompt can attempt to substitute another `playerId`.

Instead, the MCP transport is bound to a room and seat outside the model tool schema. The model sees only:

```text
get_turn()
play_move(expectedRevision, moveId)
```

This makes the tool boundary smaller and the information-isolation rule enforceable on the server.

## Claude Code alpha configuration

Claude Code supports remote HTTP MCP servers with custom headers. For an alpha room the equivalent configuration is:

```json
{
  "mcpServers": {
    "waitloop": {
      "type": "http",
      "url": "https://waitloop.run/mcp",
      "headers": {
        "Authorization": "Bearer ${WAITLOOP_SEAT_TOKEN}",
        "X-Waitloop-Room": "${WAITLOOP_ROOM_ID}"
      }
    }
  }
}
```

For local development use `http://127.0.0.1:8787/mcp`.

Do not commit `WAITLOOP_SEAT_TOKEN`.

## Transport/security notes

- `/mcp` uses the current MCP TypeScript server SDK's web-standard HTTP handler.
- Requests with a browser `Origin` are accepted only when the origin matches the Waitloop endpoint origin.
- A valid seat token is checked before the MCP handler is invoked.
- Tool handlers re-check the seat token against the authoritative room before every read or mutation.
- HTTP-level account/device authentication will be added separately for room creation and normal web access; seat authentication remains narrower than account authentication.

## Later

The seat-scoped model is intentionally compatible with future installers. A Waitloop CLI/plugin can create or join a room, receive a seat token, inject it into the platform's MCP configuration, and clear it when the room ends without changing the server tool protocol.
