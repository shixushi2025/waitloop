# Game Experience v2

This document defines the room/lobby behavior layered around the game-agnostic Waitloop room engine.

## Room phases

Waitloop exposes a presentation/runtime phase in addition to the underlying game's `playing | paused | finished` status:

```text
waiting_for_players -> playing -> paused -> playing -> finished
```

`waiting_for_players` is used by connected-agent rooms. During this phase browser controls and MCP game moves are inactive. The first authenticated MCP request from the claimed connected-agent seat is the readiness signal that starts the room.

## Seat states

Seats expose one of:

```text
ready | waiting | connecting | connected
```

Human, bot, and hosted-agent seats are ready at room creation. A connected-agent seat begins as `waiting`, becomes `connecting` after a join code claims a room-scoped credential, and becomes `connected` on the first authenticated MCP request.

These states are runtime metadata; they are not part of the game rules package.

## Join codes

Connected-agent rooms receive a high-entropy human-readable code such as:

```text
WL-7K4P9Q2MZX
```

The code is a temporary capability for claiming one room-scoped MCP seat credential. It is deliberately not embedded in the room ID; the room ID is derived from a one-way hash of the code.

Two connection paths are first-class:

```text
waitloop join <code>
raw MCP configuration
```

`/agent.md` remains the stable product/integration guide. `/join/<code>` is room-specific onboarding.

A join code can issue one credential only. Once the MCP client connects, the seat token remains the game authorization credential and the game starts.

## Dou Dizhu alpha landlord

Until bidding is implemented, the server chooses the landlord uniformly from all three seats. The landlord is no longer hard-coded to the human player.

Full bidding/scoring remains a later rules-layer capability.

## Human-visible pacing

The game server remains authoritative and may calculate deterministic bot actions immediately. The browser reconstructs a short presentation queue from authoritative history so multiple automated moves are readable without adding artificial sleeps to Worker/game logic.

The table exposes:

- authoritative current turn;
- current trick;
- recent activity history;
- connected-agent elapsed thinking time.

The turn marker always means the authoritative current turn. Presentation/replay uses a separate visual state.

## Timing policy

Casual Waitloop tables have no hard human or connected-agent turn timeout. Elapsed time is informational only. After a long wait the UI may say that an agent is taking longer than usual, but it does not force pass, choose a move, or end the game.

Hosted model HTTP calls retain infrastructure timeouts so Worker resources cannot hang indefinitely. That transport timeout is not a game clock.

Hard turn limits belong only in a future arena/ranked/benchmark policy.
