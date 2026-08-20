# Game system

This document defines the current durable game/runtime contract. Game-specific legality remains in each game package; room/lobby/seat behavior remains in the runtime layer.

## Authority model

The authoritative game state lives server-side. Clients receive derived viewer-specific projections and submit constrained actions.

The generic game implementation conceptually provides:

```ts
interface GameDefinition<TState, TPublicState> {
  readonly id: string;
  create(input: unknown): TState;
  getPublicState(state: TState, viewerId: string): TPublicState;
  getLegalMoves(state: TState, playerId: string): LegalMove[];
  applyMove(state: TState, playerId: string, moveId: string): TState;
  getCurrentPlayerId(state: TState): string | null;
  getStatus(state: TState): "playing" | "finished";
}
```

`packages/game-core` wraps this with room revision, pause/resume, viewer checks, and stale/out-of-turn validation.

## Game state vs room/runtime phase

Game rules do not own connected-agent lobby semantics.

Underlying room/game status is:

```text
playing | paused | finished
```

Waitloop runtime exposes an additional room phase:

```text
waiting_for_players -> playing -> paused -> playing -> finished
```

`waiting_for_players` is currently used by connected-agent rooms. During that phase:

- browser controls are inactive;
- MCP game moves are inactive until the seat authenticates;
- human projections do not expose dealt hands or landlord assignment;
- the connected-agent seat progresses through runtime seat states rather than game-rule states.

Seat runtime states currently include:

```text
ready | waiting | connecting | connected
```

Human, bot, and hosted-agent seats are ready at room creation. A connected-agent seat begins waiting, becomes connecting when a one-time join code issues its room credential, and becomes connected on the first authenticated MCP request. That connection is the readiness signal that starts the table.

## Hidden information

Internal state and public state are different types. Never serialize internal state and delete fields afterward.

Construct the public view from allowed fields only.

For connected-agent lobbies, even the eventual human player's own dealt hand is withheld from the browser until the room begins. This preserves the external meaning of “not dealt / not started yet” even if the runtime has prepared deterministic internal state.

## Human vs machine interaction

Humans and machine players intentionally use different projections.

### Browser human

```text
human-safe snapshot (no exhaustive legalMoves)
  -> select card IDs
  -> /play, /pass, /hint
  -> server resolves selection against authoritative legal moves
```

The browser may receive small controls such as `canPass` and `canHint`, but not the full machine move enumeration.

### Hosted / MCP agent

```text
viewer-specific machine snapshot
  -> server-generated legalMoves[]
  -> choose moveId
  -> submit exact expectedRevision + moveId
```

The model/agent does not reconstruct authoritative card payloads.

## Move IDs and revision

Legal move IDs are generated from the current authoritative state. Each ID must be unambiguous for that room revision.

Benefits:

- callers cannot invent illegal combinations;
- model tool calls remain small;
- stale decisions are rejected using `expectedRevision`;
- game rules remain the only legality authority.

## Dou Dizhu package boundary

Pure engine modules live under `packages/doudizhu`:

```text
card.ts             card identity and ordering
deck.ts             canonical deck + shuffle/deal
pattern.ts          classify one card selection
compare.ts          compare compatible patterns
move-generator.ts   enumerate legal moves
state.ts            state/public-view types
game.ts             play/turn/pass/win transitions
```

They must remain testable without Worker, Durable Objects, browser APIs, or MCP.

The current alpha chooses the landlord outside the pure play engine when preparing a table, then passes that landlord into game creation. Until bidding is implemented, the server chooses uniformly from the three seats. Full bidding/scoring belongs in the Dou Dizhu rules layer, not in generic `GameRoom` code.

See [`doudizhu-rules.md`](doudizhu-rules.md) for exact current legality.

## Automated players

The first rule bot is intentionally simple and deterministic. It uses authoritative legal moves and chooses a legal fallback without a model call.

Hosted agents receive only their seat's public state and legal move IDs. If a hosted model errors, returns an invalid move, or hits its infrastructure timeout, the runtime falls back to a deterministic legal move.

Transport/model timeouts are resource-protection mechanisms; they are not the casual-game turn clock.

## Human-visible pacing

Worker/game logic should not `sleep` merely to make bots look human.

Automated actions may be calculated immediately. The browser reconstructs a short presentation queue from authoritative public history so the user can perceive intermediate actions.

The UI distinguishes:

- **authoritative turn** — who can act now;
- **current trick** — the play that must currently be beaten;
- **recent activity** — recent play/pass history;
- **presentation/replay state** — which recorded action is being visually shown.

The `TURN` marker always means authoritative current turn. Replay/presentation must use a different visual state.

## Casual timing policy

Casual tables have no hard human or connected-agent turn timeout.

For connected agents the UI may show:

```text
Codex · THINKING · 18s
Codex · THINKING · 1m 12s · taking longer than usual
```

Elapsed time is informational. The runtime does not automatically pass, choose a move, or end the game because the casual timer reached an arbitrary threshold.

A future Arena/benchmark policy may impose hard turn limits for reproducibility/fairness, but that policy must remain separate from the normal waiting experience.

## Participant types

The runtime recognizes:

```text
Human
Bot
Hosted Agent
Connected Agent
```

Participant metadata is runtime/presentation information. It must not cause game packages to branch on Codex, Claude Code, provider names, or MCP transport details.

## Testing expectations

- rules changes get pure regression tests;
- deterministic tests inject a fixed deck/random source;
- stale/out-of-turn move rejection stays covered;
- hidden-information and lobby changes get explicit non-leakage tests;
- human-safe projection must remain distinct from machine legal-move projection;
- generic room tests must not depend on Dou Dizhu-specific behavior.