# Protocol

Waitloop uses small canonical protocols so vendor-specific coding-agent details stay outside core runtime and game clients cannot bypass authoritative rules/authorization.

## Versioning

Externally exchanged JSON uses `version: 1` unless nested in another versioned envelope. Breaking changes require a new version; additive optional fields are allowed when old consumers can ignore them safely.

## Lifecycle protocol

Canonical coding-agent states remain:

```text
idle | running | waiting | completed | failed
```

Conceptual event:

```ts
interface WaitloopAgentEventV1 {
  version: 1;
  eventId: string;
  sessionId: string;
  agent: "claude-code" | "codex" | "cursor" | "dsh" | "unknown";
  state: "running" | "waiting" | "completed" | "failed";
  occurredAt: number;
  sequence?: number;
}
```

Lifecycle events intentionally contain no prompt/source/repository/cwd/transcript/tool/assistant/native-session payloads.

Lifecycle is separate from game MCP.

## Game identity protocol

The runtime distinguishes:

```ts
interface GameSeatV1 {
  version: 1;
  id: string;
  label: string;
  ownerActorId: string;
  activeControllerActorId: string;
}

interface GameActorV1 {
  version: 1;
  id: string;
  kind: "human" | "bot" | "hosted-agent" | "connected-agent";
  label: string;
}

interface GameActorBindingV1 {
  version: 1;
  actorId: string;
  seatId: string;
  relation: "controller" | "advisor";
}
```

The pure game engine sees Seat IDs. Runtime authorization resolves Actor -> Binding -> Seat before deriving a private view or applying a move.

Current capabilities include:

```text
room:view-public
seat:view-private
seat:inspect-legal
seat:play
seat:control
room:comment
```

Only the Seat's active Controller has `seat:play`. The Seat owner has `seat:control` and can delegate/take back control.

## Room/game status

Game status:

```text
playing | paused | finished
```

Runtime room phase:

```text
waiting_for_players | playing | paused | finished
```

Connected Actor readiness:

```text
waiting -> connecting -> connected
```

`waiting_for_players` is runtime metadata, not a game-rule state.

## Machine room snapshot

The underlying game snapshot remains viewer/Seat-specific. Worker runtime augments it with Actor data such as:

```text
actors[]
seats[]
bindings[]
actorStates[]
comments[]
viewerActorId
viewerSeatId
capabilities[]
roomPhase
turnStartedAt
```

A connected advisor therefore receives the private projection of the single Seat it is explicitly bound to, while `capabilities` determines whether it may mutate that Seat.

Browser Human snapshots intentionally remove exhaustive `legalMoves[]` and expose small controls:

```text
canPlay
canPass
canHint
```

`canPlay=false` when the Human Seat is delegated to another Actor even though the Human may still see its own hand.

## Legal moves and revision

Conceptual legal move:

```ts
interface LegalMove<TMeta = unknown> {
  id: string;
  label: string;
  meta?: TMeta;
}
```

Game mutations use the current authoritative room revision. Stale/out-of-turn/non-legal actions are rejected before mutation.

## Human room operations

```text
POST /api/v1/rooms
GET  /api/v1/rooms/:roomId
POST /api/v1/rooms/:roomId/play
POST /api/v1/rooms/:roomId/pass
POST /api/v1/rooms/:roomId/hint
POST /api/v1/rooms/:roomId/control
POST /api/v1/rooms/:roomId/pause
POST /api/v1/rooms/:roomId/resume
```

`/control` currently lets the authenticated Human Seat owner select another Actor already bound to that Seat as active Controller.

## Client-neutral room creation

`POST /api/v1/rooms` is not a browser-only API. Current mode values include:

```text
bots
hosted-agent
connected-agent
companion-agent
agent-bots
```

Example headless create:

```json
{
  "version": 1,
  "gameId": "doudizhu",
  "mode": "agent-bots"
}
```

The response contains a `roomId` and join capability; no browser cookie/viewer is required for the headless mode.

## Join operations

```text
GET  /api/v1/join/<join-code>
POST /api/v1/join/<join-code>/claim
GET  /join/<join-code>
```

Claim result includes room-scoped Actor context:

```text
actorId
seatId
relation
seatStatus
roomId
wlseat_... credential
MCP endpoint + headers
```

The historical `wlseat_` prefix is retained for compatibility; the credential now authorizes one Actor binding, which may be a controller or advisor.

CLI convenience:

```text
waitloop join <join-code>
```

## MCP operations

MCP transport is bound by headers:

```text
Authorization: Bearer <wlseat_...>
X-Waitloop-Room: <room-id>
```

Model-visible tools:

```text
get_turn()
play_move(expectedRevision, moveId)
comment(text)
```

`get_turn()` returns the authenticated Actor's bound-Seat view and capability metadata.

`play_move` additionally requires `seat:play`; advisors receive `not_active_controller` until delegated.

`comment` writes a bounded room comment side channel and does not change game revision/turn/legal state.

## Error shape

JSON errors use:

```ts
interface ApiErrorV1 {
  version: 1;
  error: {
    code: string;
    message: string;
  };
}
```

Relevant authorization/runtime codes include `not_active_controller`, `not_seat_owner`, `invalid_controller`, and `controller_not_ready` in addition to stale/illegal/join errors.

Do not expose stack traces or raw Durable Object errors to clients.

The Worker implementation is runtime truth; this canonical document must be updated in the same change whenever the public protocol changes.
