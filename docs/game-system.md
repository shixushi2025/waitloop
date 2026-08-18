# Game system

## Goals

The game layer must support very small local games and hidden-information multiplayer games without coupling the runtime to any one title.

The authoritative game state lives server-side. Clients receive derived public views and submit opaque legal move IDs.

## Core contracts

A game implementation should provide these operations conceptually:

```ts
interface GameDefinition<TState, TPublicState> {
  readonly id: string;

  create(input: CreateGameInput): TState;
  getPublicState(state: TState, viewerId: string): TPublicState;
  getLegalMoves(state: TState, playerId: string): LegalMove[];
  applyMove(state: TState, playerId: string, moveId: string): TState;
  getStatus(state: TState): "waiting" | "playing" | "finished";
}
```

Implementations may use richer generic types internally, but the runtime should need only this shape.

## Move IDs

Legal moves are generated from the current authoritative state. Each move ID must be deterministic within that state and unambiguous.

For Dou Dizhu a legal move can map to a canonical card selection plus pattern metadata, but MCP/web callers only need the generated ID.

Benefits:

- callers cannot invent illegal combinations
- model tool calls are smaller and more reliable
- stale turn choices can be rejected using room revision
- the rules engine remains the only legality authority

## Hidden information

Internal state and public state are different types.

Never implement privacy like this:

```ts
const copy = JSON.parse(JSON.stringify(internalState));
delete copy.otherPlayersHands;
return copy;
```

Instead construct the public view from allowed fields:

```ts
return {
  myHand: state.hands[viewerId],
  remaining: countHands(state.hands),
  lastMove: state.lastMove,
};
```

## Dou Dizhu engine boundaries

The engine is split into pure modules:

```text
card.ts             card identity and ordering
deck.ts             canonical deck + shuffle/deal
pattern.ts          classify one card selection
compare.ts          compare compatible patterns
move-generator.ts   enumerate legal moves
state.ts            game state types and public views
game.ts             bidding/play state machine
```

Rules should be testable without Worker, Durable Objects, WebSocket, or MCP.

## First-rule scope

The first complete Dou Dizhu rules target includes:

- 54-card deck, including two jokers
- three players
- landlord assignment through a simplified deterministic bidding API
- singles, pairs, triples
- triple + single, triple + pair
- straights
- consecutive pairs
- airplanes (with documented wing constraints)
- four-with-two variants
- bombs
- rocket
- pass rules
- trick reset after other players pass
- win when a player's hand becomes empty

Bidding/scoring multipliers are lower priority than correct card legality and turn progression.

## Determinism

Tests should inject a shuffle/random source or provide a fixed deck. Production may use cryptographically adequate randomness available in the runtime.

No test should depend on nondeterministic shuffling.

## Bot policy

The first non-LLM bot can be intentionally simple:

1. obtain legal moves
2. prefer the lowest-cost legal non-bomb move
3. pass when strategically allowed according to a small heuristic

The bot is for completing a table, not for proving strong gameplay.

## Agent participation

Agents get the same public state constraints as a human player. An MCP caller never receives another player's hand.

A turn response should provide enough context for strategy:

- role (landlord/farmer)
- own hand
- current/last move
- remaining card counts
- public move history as needed
- teammate identity where relevant
- legal move IDs with human-readable labels

The server still validates the selected move ID and expected room revision.
