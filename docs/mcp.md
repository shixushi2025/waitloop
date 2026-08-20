# MCP game boundary

Waitloop exposes a remote MCP endpoint at `/mcp` for an agent that occupies one temporary game seat.

MCP is intentionally **not** used to detect whether a coding agent is running. Lifecycle detection belongs to platform adapters/hooks. MCP only lets an already-authorized agent inspect and act on its own game seat.

## Connected-agent onboarding

Connected-agent rooms start in `waiting_for_players` and expose a short-lived human-readable join code such as:

```text
WL-7K4P9Q2MZX
```

Two connection paths are first-class:

```text
waitloop join <code>
raw room-scoped MCP configuration
```

Room-specific instructions are available at:

```text
https://waitloop.run/join/<join-code>
```

`/agent.md` remains the stable universal Waitloop integration guide. `/join/<code>` is temporary onboarding for one room.

## Join-code and seat lifecycle

A join code is a temporary capability to issue **one** room-scoped seat credential.

Current flow:

```text
room created
  -> connected seat waiting
  -> join code claimed
  -> wlseat_... credential issued
  -> seat connecting
  -> first authenticated MCP request
  -> seat connected
  -> room begins playing
```

The join code itself is not the ongoing game credential and should not be used as a tool argument. The room ID is derived independently from the raw code so the public room identifier is not a substitute for the join capability.

## Authentication model

After claim, every MCP HTTP request carries:

```text
Authorization: Bearer <wlseat_...>
X-Waitloop-Room: <room-id>
```

The server stores only a SHA-256 digest of the seat token.

Neither the room ID nor the seat token is exposed as a model-visible tool argument. The transport resolves the authenticated seat before constructing the tool surface, so the model cannot ask for another player's view.

A seat token authorizes exactly one player seat in one room. It is not an account/device/lifecycle token and should be discarded when the room ends.

## Tools

The tool surface is deliberately small.

### `get_turn`

Input:

```json
{}
```

Returns the authenticated player's viewer-specific machine snapshot, including:

- role and own hand after the room starts;
- public remaining-card counts and move history;
- current player/current trick context;
- room revision;
- server-generated legal move IDs when it is this seat's turn.

It never returns another player's private hand.

### `play_move`

Input:

```json
{
  "expectedRevision": 12,
  "moveId": "play:..."
}
```

The agent must use a `moveId` returned by `get_turn` and the exact associated revision. Stale revisions, out-of-turn calls, and non-legal move IDs are rejected before state mutation.

The agent does not submit raw authoritative cards or arbitrary game state.

## Why room/seat identity lives in transport headers

This is intentionally **not** the tool API:

```text
get_turn(roomId, playerId, seatToken)
play_move(roomId, playerId, seatToken, ...)
```

Putting identity/credentials in normal model-visible arguments makes substitution easier and unnecessarily expands the tool schema.

The model sees only:

```text
get_turn()
play_move(expectedRevision, moveId)
```

while the HTTP transport is already bound to the room and seat.

## Raw MCP configuration

Users/agents without the Waitloop CLI can claim the room through the `/join/<code>` page/API and use the returned room-scoped configuration directly.

Equivalent HTTP MCP configuration:

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

Do not commit, log, place in a prompt, or persist the raw seat token beyond its room lifetime.

## CLI path

With the public CLI installed:

```bash
waitloop join WL-7K4P9Q2MZX
```

For machine-readable output:

```bash
waitloop join WL-7K4P9Q2MZX --json
```

The CLI performs the same join-code exchange and prints the temporary MCP configuration. It does not change the MCP server protocol.

## Timing and readiness

The first authenticated MCP request is the connected seat readiness signal. Merely creating or claiming the room does not start the table.

Casual Waitloop tables have no hard connected-agent turn timeout. Elapsed time may be displayed as a reminder, but the server does not force a pass/move because a casual timer expired.

## Transport/security notes

- `/mcp` uses the MCP TypeScript server SDK web-standard HTTP handler.
- browser `Origin` requests are accepted only when the origin matches the Waitloop endpoint origin.
- seat authentication happens before the MCP handler exposes the seat tools.
- tool handlers re-check the seat token against authoritative room state for reads/mutations.
- room IDs are routing/context identifiers, not authorization secrets.
- seat credentials are narrower than lifecycle device credentials and must never be reused for lifecycle ingestion.

See [`security.md`](security.md) for the complete credential/trust model and [`game-system.md`](game-system.md) for room/seat phases.