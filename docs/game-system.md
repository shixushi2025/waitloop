# Game system

This document defines the durable game/runtime contract. Game-specific legality belongs in game packages; room identity, Actor bindings, readiness, authorization, and presentation belong in the runtime.

## Authority model

The authoritative game state lives server-side. Clients receive viewer-specific projections and submit constrained actions.

`packages/game-core` owns generic room revision/stale-turn checks. `packages/doudizhu` owns Dou Dizhu cards, patterns, legal moves, turn/pass/win behavior. `GameRoom` owns runtime identity and authorization around the pure game.

## Seat, Actor, Binding, Controller

A **Seat** is one actual player position known by the game engine. An **Actor** is an entity that can relate to a Seat.

```text
Seat
  id
  ownerActorId
  activeControllerActorId

Actor
  human | bot | hosted-agent | connected-agent

Binding
  actorId -> seatId
  relation: controller | advisor
```

This distinction is intentional:

- Human and connected Agent can own/control separate Seats and be independent players.
- A connected Agent can be an `advisor` bound to the Human's Seat without occupying a fourth Dou Dizhu Seat.
- The Human Seat owner can delegate `activeControllerActorId` to that advisor and later take control back.
- Delegation never changes the Seat's hand, role, history, or identity.

Game packages see only Seat IDs. They do not know whether the current Seat is controlled by a Human, Bot, hosted model, or connected Agent.

## Capabilities

Runtime authorization is capability-based. Current capabilities include:

```text
room:view-public
seat:view-private
seat:inspect-legal
seat:play
seat:control
room:comment
```

A bound advisor receives public room state plus the private state/legal options of the Seat it is explicitly bound to and may comment. It does **not** receive `seat:play` until it is the Seat's active Controller.

The Seat owner retains `seat:control`, so it can delegate/take back control. The server capability check is authoritative; UI button state is not authorization.

## Current relationship examples

### Independent Agent player

```text
Seat A -> Human controller
Seat B -> Connected Agent controller
Seat C -> Bot controller
```

Current room mode: `connected-agent`.

### Agent companion / advisor

```text
Seat A
  owner: Human
  active controller: Human
  bindings:
    Human -> controller
    Connected Agent -> advisor

Seat B -> Bot
Seat C -> Bot
```

Current room mode: `companion-agent`.

The advisor can see Seat A's hand/legal options and call `comment`, but `play_move` returns `not_active_controller` until the Human delegates the Seat.

### Fully headless Agent table

```text
Seat A -> Connected Agent controller
Seat B -> Bot
Seat C -> Bot
```

Current room mode: `agent-bots`.

This table can be created, joined, and played entirely through HTTP + MCP with no Web UI.

## Runtime phase and readiness

Underlying game status remains:

```text
playing | paused | finished
```

Waitloop runtime adds:

```text
waiting_for_players -> playing -> paused -> playing -> finished
```

Connected Actor runtime state includes:

```text
ready | waiting | connecting | connected
```

A connected Actor begins waiting, becomes connecting when a join code issues its room credential, and becomes connected on its first authenticated MCP request. That request is the readiness signal that starts a connected table.

During `waiting_for_players`:

- game input is inactive;
- the Human lobby projection does not expose dealt cards or landlord assignment;
- no casual countdown can force a move.

## Hidden information

Internal state and public state are different types. Never serialize internal state and remove secret fields afterward.

A bound Actor receives only the private projection of its own bound Seat. An advisor sees the Human Seat's private hand because the user explicitly created that binding; it must never gain an unrelated Seat's private hand.

A Human who delegates control retains its private Seat view, but Human play/pass/hint controls are disabled while another Actor is active Controller.

## Human vs machine interaction

### Browser Human

```text
human-safe snapshot (no exhaustive legalMoves)
  -> select card IDs
  -> /play, /pass, /hint
  -> server resolves selection against authoritative legal moves
```

Human controls include `canPlay`, `canPass`, and `canHint` and reflect active Controller authorization.

### Hosted / connected Actor

```text
private projection of bound Seat
  -> server-generated legalMoves[]
  -> choose moveId
  -> play_move(expectedRevision, moveId)
```

`play_move` succeeds only with `seat:play` and an exact current revision.

## Comments are a side channel

Room comments are stored separately from game action history.

```text
game history -> affects/reports authoritative play
room comments -> companion/advisor conversation only
```

`comment(text)` must not change:

- game state;
- turn order;
- legal moves;
- game revision.

This lets an Agent suggest, react, or lightly comment without becoming part of the game rules.

## Room creation is client-neutral

Web is a Human client, not the required room creator. The control plane is the HTTP Room/Join API.

Example headless table:

```http
POST /api/v1/rooms
Content-Type: application/json

{"version":1,"gameId":"doudizhu","mode":"agent-bots"}
```

The response returns a room ID and join code. The Agent claims the code, connects the fixed `/mcp` endpoint with room-scoped headers, and plays. CLI and Web are convenience clients over the same runtime.

## Move IDs and revision

Legal move IDs are generated from authoritative state and are valid for a specific room revision. Benefits:

- clients cannot invent illegal combinations;
- model calls stay small;
- stale decisions are rejected;
- game rules remain the legality authority.

## Dou Dizhu boundary

Pure engine modules remain under `packages/doudizhu`. The current pre-bidding alpha chooses the landlord outside the pure play engine and passes the selected Seat ID into game creation. Full bidding/scoring belongs in the Dou Dizhu rules layer, not the generic room/Actor layer.

See [`doudizhu-rules.md`](doudizhu-rules.md).

## Automated players

Rule bots use authoritative legal moves with no model call. Hosted agents receive only their controlled Seat's public/private projection and move IDs. Provider HTTP timeouts protect Worker resources; they are not casual turn clocks.

## Human-visible pacing

Worker/game logic does not sleep to look human. The browser replays authoritative action-history deltas while keeping current turn separate from presentation state.

The UI distinguishes:

- current authoritative Seat turn;
- current Seat Controller;
- current trick;
- recent game activity;
- companion comments;
- presentation/replay state.

## Casual timing

Casual Human/connected-Agent turns have no hard timeout. Elapsed time may be displayed, but the runtime does not automatically pass, move, or forfeit because an arbitrary casual threshold elapsed.

Hard timing can be a future Arena/benchmark policy and must stay separate.

## Testing expectations

- game rule changes get pure regression tests;
- Actor/Seat authorization changes get capability tests;
- advisor changes test private-view scope and non-play behavior;
- delegation changes test that only active Controller can mutate the Seat;
- comments test non-game side-channel semantics;
- hidden-information/lobby changes get explicit non-leakage tests;
- browser human projection remains distinct from machine legal-move projection;
- generic room/runtime code must not introduce Dou Dizhu-specific controller logic.
