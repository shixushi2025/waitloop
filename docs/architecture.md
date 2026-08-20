# Architecture

## Overview

Waitloop is a TypeScript monorepo deployed as one Cloudflare Worker with Static Assets and Durable Objects.

Responsibilities:

1. **Lifecycle adapters** map vendor-specific coding-agent events into Waitloop lifecycle state.
2. **Protocol** defines canonical lifecycle/game contracts.
3. **CLI** provides local pairing/adapters/diagnostics/Join convenience.
4. **HTTP control plane** creates rooms, claims Actor capabilities, and changes owner-authorized control.
5. **Game runtime** stores authoritative room/Actor/Seat state in `GameRoom` Durable Objects.
6. **Game packages** implement pure deterministic rules.
7. **MCP gameplay plane** lets one authenticated connected Actor inspect/play/comment.
8. **Web** is Human UI/presentation only; it is not required for Agent operation.

```text
coding lifecycle
Claude/Cursor/Codex -> integrations -> protocol -> AgentSession DO -> Web attention

room control plane
Web / CLI / Agent HTTP -> /api/v1/rooms + /api/v1/join/* -> GameRoom DO

room gameplay plane
connected Agent -> /mcp -----------------------------> GameRoom DO
hosted provider -> hosted runner --------------------> GameRoom DO
Human Web -> room human endpoints -------------------> GameRoom DO
```

## Deployment

```text
waitloop.run
  ├─ static product + Agent surfaces
  │   ├─ /agent.md
  │   ├─ /agent.json
  │   ├─ /llms.txt
  │   ├─ /skills/waitloop/SKILL.md
  │   ├─ /game.html
  │   └─ /join/<code>
  ├─ /api/*
  ├─ /mcp
  ├─ AgentSession DO
  ├─ DeviceRegistry DO
  ├─ PairingRequest DO
  └─ GameRoom DO
```

GitHub `main` auto-deploys through Cloudflare repository integration. CI independently validates Wrangler dry-run bundling.

## Code boundaries

```text
packages/protocol       pure lifecycle contracts/validation
packages/game-core      pure game-agnostic room/state transition contracts
packages/doudizhu       pure Dou Dizhu legality/state transitions
packages/cli            local Node convenience/integration layer
integrations/*          vendor-specific lifecycle adapters
worker/*                Cloudflare control/runtime/MCP/hosted boundaries
apps/web/public/*        Human UI + public Agent surfaces
```

Core packages never depend on vendor integration or browser/Cloudflare details.

## GameRoom domain boundary

`GameRoom` owns the complete persisted game plus runtime authorization metadata.

The important split is:

```text
Pure game state
  players = Seat IDs
  hand/role/turn/history

Runtime identity
  Actors
  Seats
  Bindings
  active Controller
  Actor readiness
  comments
  credentials/capabilities
```

### Seat

One player position understood by the game engine. Its hand/role/history survive Controller changes.

### Actor

Human, Bot, Hosted Agent, or Connected Agent runtime identity.

### Binding

Connects an Actor to one Seat with relation `controller` or `advisor`.

### Controller

Only `activeControllerActorId` receives `seat:play`. The Seat owner retains `seat:control` and can delegate/take back control.

This keeps Dou Dizhu/game packages unaware of Codex/Claude/MCP/UI concepts.

## Backward-compatible migration

Older persisted rooms modeled participant==player==seat. `GameRoom` normalizes that shape into the new Actor/Seat/Binding model on read:

```text
legacy participant P
  -> Actor P
  -> Seat P
  -> controller Binding P -> P
```

Legacy `participants` and `seatStates` are temporarily included in snapshots while browser/runtime projections migrate. New code should use `actors`, `seats`, `bindings`, and `actorStates`.

## Runtime phase/readiness

Game status:

```text
playing | paused | finished
```

Runtime phase:

```text
waiting_for_players -> playing -> paused -> playing -> finished
```

Connected Actor readiness:

```text
waiting -> connecting -> connected
```

The first authenticated MCP request marks the joined Actor ready and allows a waiting room to start.

## Client-neutral room creation

Room creation no longer conceptually belongs to the browser.

```text
POST /api/v1/rooms
```

can be called by Web, CLI, or an Agent directly. `agent-bots` deliberately creates no Human viewer cookie/snapshot and supports a fully headless lifecycle:

```text
Agent HTTP create
  -> Join code
  -> Join claim
  -> MCP connection
  -> game
```

Web is required only when a Human wants a visual/interactive client.

## Connected Agent relationships

### Separate player

`connected-agent` binds the connected Actor as Controller of its own Seat.

### Companion/advisor

`companion-agent` binds the connected Actor as advisor of the Human Seat. The Actor receives that explicitly granted Seat's private projection and may comment, but cannot mutate it until the owner delegates Controller.

### Headless player

`agent-bots` binds the connected Actor as Controller of its own Seat against two deterministic bots, with no browser dependency.

## HTTP vs MCP

The intended split is:

```text
HTTP / CLI control plane
  create room
  claim Join capability
  inspect/control owner-managed room relationship

MCP gameplay plane
  get_turn()
  play_move(expectedRevision, moveId)
  comment(text)
```

Do not duplicate game rules/authorization inside CLI/Web/MCP clients; they all converge on `GameRoom` and the registered game definition.

## Human projection

Browser Human uses a viewer credential and human-safe projection:

- private hand for its Seat after start;
- no exhaustive machine `legalMoves[]`;
- `canPlay/canPass/canHint` based on authoritative active Controller capability;
- retains private view while delegated but loses mutation controls.

## Comment side channel

Room comments belong to runtime metadata, not game history. `comment` does not increment game revision or affect turn/legal state.

## Trust boundaries

Validate every external boundary:

- lifecycle adapter -> ingest;
- browser pairing -> PairingRequest;
- Web/Agent -> Room API;
- Join code -> Actor credential issuance;
- MCP -> Actor binding/capability;
- Human control mutation -> Seat owner + same-Seat binding;
- hosted output -> server-generated legal move;
- persisted DO state -> normalized/version-aware model.

## Concurrency/revision

Durable Objects serialize requests per room, while explicit room/game revision rejects stale Human/Agent decisions. Active Controller authorization prevents Human and Agent from simultaneously mutating the same Seat.

## Failure behavior

Waitloop fails open with respect to primary coding work. Lifecycle delivery is bounded/best-effort; game failures do not hide work attention; hosted provider failures use game fallbacks; casual connected Actors may take a long time without a forced timer.
