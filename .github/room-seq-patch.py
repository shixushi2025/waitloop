from __future__ import annotations

from pathlib import Path
import json
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def replace_count(text: str, old: str, new: str, expected: int, label: str) -> str:
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{label}: expected {expected} matches, found {count}")
    return text.replace(old, new)


sequence_path = Path("worker/src/room-sequence.ts")
sequence_path.write_text(
    '''export interface RoomSequenceComparableV1 {
  roomSeq?: number;
  room: {
    revision: number;
    status: string;
  };
  roomPhase: string;
  turnStartedAt: number;
  roomOwnerActorId: string;
  seats: Array<{
    id: string;
    ownerActorId: string;
    activeControllerActorId: string;
  }>;
  actors: Array<{
    id: string;
    kind: string;
    temporary?: boolean;
  }>;
  bindings: Array<{
    actorId: string;
    seatId: string;
    relation: string;
  }>;
  actorStates: Record<string, {
    actorId: string;
    status: string;
    lastSeenAt?: number;
    connectedAt?: number;
    disconnectedAt?: number;
    statusChangedAt?: number;
  }>;
  comments: Array<{
    id: string;
    actorId: string;
    text: string;
    createdAt: number;
  }>;
  botPlayerIds: string[];
  temporaryBotSeatIds: string[];
  join?: {
    actorId?: string;
    seatId?: string;
    playerId?: string;
    claimedAt?: number;
  };
}

function compareFirst(left: readonly unknown[], right: readonly unknown[]): number {
  return String(left[0] ?? "").localeCompare(String(right[0] ?? ""));
}

export function normalizeRoomSeq(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 1 ? value as number : 1;
}

export function roomEventSignature(state: RoomSequenceComparableV1): string {
  const seats = state.seats
    .map((seat) => [seat.id, seat.ownerActorId, seat.activeControllerActorId] as const)
    .sort(compareFirst);
  const actors = state.actors
    .map((actor) => [actor.id, actor.kind, actor.temporary === true] as const)
    .sort(compareFirst);
  const bindings = state.bindings
    .map((binding) => [binding.actorId, binding.seatId, binding.relation] as const)
    .sort(compareFirst);
  const actorStates = Object.values(state.actorStates)
    .map((runtime) => [runtime.actorId, runtime.status] as const)
    .sort(compareFirst);
  const comments = state.comments.map((comment) => [comment.id, comment.actorId, comment.text, comment.createdAt]);
  const join = state.join
    ? [
        state.join.actorId ?? state.join.playerId ?? null,
        state.join.seatId ?? state.join.playerId ?? null,
        state.join.claimedAt ?? null,
      ]
    : null;

  return JSON.stringify({
    roomStatus: state.room.status,
    roomPhase: state.roomPhase,
    turnStartedAt: state.turnStartedAt,
    roomOwnerActorId: state.roomOwnerActorId,
    seats,
    actors,
    bindings,
    actorStates,
    comments,
    botPlayerIds: [...state.botPlayerIds].sort(),
    temporaryBotSeatIds: [...state.temporaryBotSeatIds].sort(),
    join,
  });
}

export function nextRoomSeq(
  previous: RoomSequenceComparableV1,
  next: RoomSequenceComparableV1,
): number {
  const current = normalizeRoomSeq(previous.roomSeq);
  if (previous.room.revision !== next.room.revision) return current + 1;
  return roomEventSignature(previous) === roomEventSignature(next) ? current : current + 1;
}
'''
)

sequence_test_path = Path("worker/src/room-sequence.test.ts")
sequence_test_path.write_text(
    '''import { describe, expect, it } from "vitest";

import {
  nextRoomSeq,
  normalizeRoomSeq,
  roomEventSignature,
  type RoomSequenceComparableV1,
} from "./room-sequence";

function state(overrides: Partial<RoomSequenceComparableV1> = {}): RoomSequenceComparableV1 {
  return {
    roomSeq: 7,
    room: { revision: 4, status: "playing" },
    roomPhase: "playing",
    turnStartedAt: 100,
    roomOwnerActorId: "human",
    seats: [
      { id: "seat-1", ownerActorId: "human", activeControllerActorId: "human" },
      { id: "seat-2", ownerActorId: "agent", activeControllerActorId: "agent" },
    ],
    actors: [
      { id: "human", kind: "human" },
      { id: "agent", kind: "connected-agent" },
    ],
    bindings: [
      { actorId: "human", seatId: "seat-1", relation: "controller" },
      { actorId: "agent", seatId: "seat-2", relation: "controller" },
    ],
    actorStates: {
      human: { actorId: "human", status: "ready", statusChangedAt: 1 },
      agent: { actorId: "agent", status: "connected", statusChangedAt: 2, lastSeenAt: 3 },
    },
    comments: [],
    botPlayerIds: [],
    temporaryBotSeatIds: [],
    ...overrides,
  };
}

describe("Room semantic event sequence", () => {
  it("normalizes legacy or invalid persisted sequence values", () => {
    expect(normalizeRoomSeq(undefined)).toBe(1);
    expect(normalizeRoomSeq(0)).toBe(1);
    expect(normalizeRoomSeq(7)).toBe(7);
  });

  it("advances when game revision changes", () => {
    const previous = state();
    const next = state({ room: { revision: 5, status: "playing" } });
    expect(nextRoomSeq(previous, next)).toBe(8);
  });

  it("advances for comments even when game revision is unchanged", () => {
    const previous = state();
    const next = state({
      comments: [{ id: "comment-1", actorId: "agent", text: "pass", createdAt: 10 }],
    });
    expect(nextRoomSeq(previous, next)).toBe(8);
    expect(next.room.revision).toBe(previous.room.revision);
  });

  it("advances for Controller changes without changing game revision", () => {
    const previous = state();
    const next = state({
      seats: [
        { id: "seat-1", ownerActorId: "human", activeControllerActorId: "agent" },
        { id: "seat-2", ownerActorId: "agent", activeControllerActorId: "agent" },
      ],
    });
    expect(nextRoomSeq(previous, next)).toBe(8);
  });

  it("advances for semantic presence transitions", () => {
    const previous = state();
    const next = state({
      actorStates: {
        ...previous.actorStates,
        agent: { actorId: "agent", status: "disconnected", statusChangedAt: 20, lastSeenAt: 21 },
      },
    });
    expect(nextRoomSeq(previous, next)).toBe(8);
  });

  it("does not advance for heartbeat-only timestamp refreshes", () => {
    const previous = state();
    const next = state({
      actorStates: {
        ...previous.actorStates,
        agent: {
          actorId: "agent",
          status: "connected",
          statusChangedAt: 999,
          connectedAt: 998,
          lastSeenAt: 1_000_000,
        },
      },
    });
    expect(nextRoomSeq(previous, next)).toBe(7);
  });

  it("is stable when collection order changes", () => {
    const previous = state();
    const next = state({
      seats: [...previous.seats].reverse(),
      actors: [...previous.actors].reverse(),
      bindings: [...previous.bindings].reverse(),
      actorStates: Object.fromEntries(Object.entries(previous.actorStates).reverse()),
    });
    expect(roomEventSignature(next)).toBe(roomEventSignature(previous));
    expect(nextRoomSeq(previous, next)).toBe(7);
  });
});
'''
)

contract_test_path = Path("worker/src/room-sequence-contract.test.ts")
contract_test_path.write_text(
    '''import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(import.meta.dirname, "game-room.ts"), "utf8");

describe("GameRoom roomSeq integration contract", () => {
  it("centralizes state commits and exposes roomSeq in snapshots", () => {
    expect(source).toContain("private async commitState(");
    expect(source).toContain("next.roomSeq = nextRoomSeq(previous, next);");
    expect(source).toContain("roomSeq: normalizeRoomSeq(state.roomSeq)");
    expect(source).toContain("roomSeq: state.roomSeq");
    expect(source).toContain("roomSeq: 1");
    expect(source.match(/await this\\.commitState\\(/g)).toHaveLength(16);
    expect(source.match(/await this\\.writeState\\(/g)).toHaveLength(2);
    expect(source.match(/await this\\.broadcast\\(/g)).toHaveLength(1);
  });
});
'''
)

game_path = Path("worker/src/game-room.ts")
game = game_path.read_text()
game = replace_once(
    game,
    '} from "./room-control";\n',
    '} from "./room-control";\nimport { nextRoomSeq, normalizeRoomSeq } from "./room-sequence";\n',
    "room sequence import",
)
game = replace_once(
    game,
    'interface PersistedGameRoomV1 {\n  version: 1;\n  room: StoredGameRoom;\n',
    'interface PersistedGameRoomV1 {\n  version: 1;\n  roomSeq?: number;\n  room: StoredGameRoom;\n',
    "persisted roomSeq",
)
game = replace_once(
    game,
    'interface NormalizedGameRoomV1 extends PersistedGameRoomV1 {\n  viewerTokenHashes: Record<string, string>;\n',
    'interface NormalizedGameRoomV1 extends PersistedGameRoomV1 {\n  roomSeq: number;\n  viewerTokenHashes: Record<string, string>;\n',
    "normalized roomSeq",
)
game = replace_once(
    game,
    'export type GameRoomSnapshotV1 = StoredGameSnapshot & {\n  // Legacy projections remain during the public browser migration.\n',
    'export type GameRoomSnapshotV1 = StoredGameSnapshot & {\n  roomSeq: number;\n  // Legacy projections remain during the public browser migration.\n',
    "snapshot roomSeq type",
)
game = replace_once(
    game,
    '  return {\n    ...state,\n    viewerTokenHashes: { ...(state.viewerTokenHashes ?? {}) },\n',
    '  return {\n    ...state,\n    roomSeq: normalizeRoomSeq(state.roomSeq),\n    viewerTokenHashes: { ...(state.viewerTokenHashes ?? {}) },\n',
    "normalize roomSeq",
)
game = replace_once(
    game,
    '    return {\n      ...base,\n      currentPlayerId: waiting ? null : base.currentPlayerId,\n',
    '    return {\n      ...base,\n      roomSeq: state.roomSeq,\n      currentPlayerId: waiting ? null : base.currentPlayerId,\n',
    "snapshot roomSeq value",
)
game = replace_once(
    game,
    '  private async writeState(state: NormalizedGameRoomV1): Promise<void> {\n    await this.ctx.storage.put(STATE_KEY, state);\n  }\n\n  private async consumeRateLimit',
    '''  private async writeState(state: NormalizedGameRoomV1): Promise<void> {
    await this.ctx.storage.put(STATE_KEY, state);
  }

  private async commitState(previous: NormalizedGameRoomV1, next: NormalizedGameRoomV1): Promise<void> {
    next.roomSeq = nextRoomSeq(previous, next);
    await this.writeState(next);
    if (next.roomSeq !== previous.roomSeq) await this.broadcast(next);
  }

  private async consumeRateLimit''',
    "central commit helper",
)
game = replace_once(
    game,
    '      let state: NormalizedGameRoomV1 = {\n        version: 1,\n        room,\n',
    '      let state: NormalizedGameRoomV1 = {\n        version: 1,\n        roomSeq: 1,\n        room,\n',
    "initialize roomSeq",
)
game = replace_count(
    game,
    '      await this.writeState(next);\n      await this.broadcast(next);',
    '      await this.commitState(state, next);',
    12,
    "semantic next commits",
)
game = replace_count(
    game,
    '      await this.writeState(moved.value);\n      await this.broadcast(moved.value);',
    '      await this.commitState(state, moved.value);',
    2,
    "semantic moved commits",
)
game = replace_once(
    game,
    '      await this.writeState(next);\n      if (statusChanged || started) await this.broadcast(next);\n',
    '      await this.commitState(state, next);\n',
    "connect commit",
)
game = replace_once(
    game,
    '      await this.writeState(next);\n      return { ok: true, value: this.snapshot(next, actorId) };\n',
    '      await this.commitState(state, next);\n      return { ok: true, value: this.snapshot(next, actorId) };\n',
    "credential-only commit",
)
if len(re.findall(r"await this\.commitState\(", game)) != 16:
    raise SystemExit("GameRoom should contain exactly 16 commitState calls")
if len(re.findall(r"await this\.writeState\(", game)) != 2:
    raise SystemExit("GameRoom should contain exactly two direct writeState calls")
if len(re.findall(r"await this\.broadcast\(", game)) != 1:
    raise SystemExit("GameRoom should contain exactly one direct broadcast call")
game_path.write_text(game)

protocol_path = Path("docs/protocol.md")
protocol = protocol_path.read_text()
protocol = replace_once(
    protocol,
    'Agent snapshots include:\n\n```text\nactors[]\n',
    'Agent snapshots include:\n\n```text\nroomSeq\nactors[]\n',
    "protocol snapshot roomSeq",
)
protocol = replace_once(
    protocol,
    'Human snapshots remove exhaustive machine `legalMoves[]` and expose constrained Human actions in `controls`.\n',
    '''Human snapshots remove exhaustive machine `legalMoves[]` and expose constrained Human actions in `controls`.

`revision` and `roomSeq` have different purposes:

```text
revision  game-rule concurrency cursor used by play/pass expectedRevision
roomSeq   monotonic semantic Room-event cursor used by future subscriptions
```

`roomSeq` advances when client-visible Room meaning changes: game revision/status, comments, Controller/binding/temporary-Bot changes, Room phase, Join claim, or semantic Actor status transitions. Credential rotation and heartbeat-only timestamp refreshes do not advance it.
''',
    "protocol sequence semantics",
)
protocol_path.write_text(protocol)

game_system_path = Path("docs/game-system.md")
game_system = game_system_path.read_text()
game_system = replace_once(
    game_system,
    'Local `join_room` and `create_room` perform the first authenticated request before reporting connected.\n\n## Stable local Agent bridge\n',
    '''Local `join_room` and `create_room` perform the first authenticated request before reporting connected.

## Game revision versus Room event sequence

Every snapshot exposes two independent monotonic concepts:

```text
game revision
  authoritative game mutation version
  required by expectedRevision for play/pass concurrency

roomSeq
  semantic Room-event version
  advances for any client-visible Room change, including comments,
  Controller/temporary-Bot changes, Room phase, Join claim, and
  meaningful Actor status transitions
```

Legacy persisted Rooms normalize to `roomSeq = 1`. All later state writes pass through a centralized commit helper that increments and broadcasts only when the semantic Room signature changes. Heartbeat-only `lastSeenAt` updates and credential-only recovery writes are persisted without advancing `roomSeq` or broadcasting.

Collection ordering is normalized before semantic comparison, so harmless array/map ordering differences do not create false events.

## Stable local Agent bridge
''',
    "game system sequence section",
)
game_system_path.write_text(game_system)

architecture_path = Path("docs/architecture.md")
architecture = architecture_path.read_text()
architecture = replace_once(
    architecture,
    'game state\nSeats\nActors\nBindings\n',
    'game state\nroomSeq semantic event cursor\nSeats\nActors\nBindings\n',
    "architecture roomSeq storage",
)
architecture_path.write_text(architecture)

agents_path = Path("AGENTS.md")
agents = agents_path.read_text()
agents = replace_once(
    agents,
    'Future Room event subscriptions must not use game revision as the only cursor. Add a separate semantic `roomSeq`/event sequence for client-visible changes such as comments, Controller transitions, Room phase, Join/connection transitions, and semantic presence changes. Heartbeat-only timestamp refreshes must not advance that cursor.\n\nSubscription reuse must be scoped by origin + Room + authorized principal/credential scope + projection type/version. Never share one private snapshot stream solely by Room ID.\n',
    '''Current Room snapshots include a separate semantic `roomSeq` cursor. All persisted state writes must pass through the centralized GameRoom commit path: game/comment/Controller/Room-phase/Join/semantic-presence changes advance and broadcast `roomSeq`, while credential-only and heartbeat-only timestamp writes do not.

Future Room subscriptions must use `roomSeq`, not game revision, as their update cursor. Subscription reuse must be scoped by origin + Room + authorized principal/credential scope + projection type/version. Never share one private snapshot stream solely by Room ID.
''',
    "AGENTS current sequence invariant",
)
agents_path.write_text(agents)

status_path = Path("docs/status.md")
status = status_path.read_text()
status = replace_once(
    status,
    'This candidate does not pretend to solve multi-Actor synchronization. Future connected/companion freshness requires a Room event subscription with a semantic event cursor and authorization-specific projection reuse, not permanent polling.\n',
    '''Alpha.9 also adds the Room-event foundation: every Agent and Human snapshot includes `roomSeq`, legacy Rooms normalize to sequence 1, and all GameRoom state writes flow through one semantic commit path. Comments, Controller changes, Room phase, Join claim, meaningful Actor status, and game revision changes advance `roomSeq`; heartbeat-only `lastSeenAt` and credential-only writes do not. Multi-Actor subscription transport is still future work and must reuse streams by Room plus authorized principal/projection, never by Room ID alone.
''',
    "status room sequence foundation",
)
status = status.replace(
    '- 98 unit/regression tests across rules, identity, controller fallback, lifecycle, CLI, MCP, Human MCP App custody/presentation, and browser request budgets;\n',
    '- 106 unit/regression tests across rules, identity, controller fallback, lifecycle, CLI, MCP, Human MCP App custody/presentation, browser request budgets, and Room event sequencing;\n',
)
status = status.replace(
    '- source-contract checks prohibiting a periodic Human MCP App refresh timer;\n',
    '- source-contract checks prohibiting a periodic Human MCP App refresh timer;\n- Room sequence tests proving game/comment/Controller/status changes advance, heartbeat-only writes do not, and centralized commits own all write/broadcast decisions;\n',
)
status = status.replace(
    '- Room event sequencing separate from game revision; comments, Controller changes, and semantic presence changes need a subscription cursor such as `roomSeq`;\n- subscription reuse must be keyed by Room plus authorized principal/projection, not Room ID alone;\n',
    '- subscription transport using the implemented `roomSeq` cursor is not yet available;\n- subscription reuse must still be implemented by Room plus authorized principal/projection, not Room ID alone;\n',
)
status_path.write_text(status)

roadmap_path = Path("docs/roadmap.md")
roadmap = roadmap_path.read_text()
roadmap = replace_once(
    roadmap,
    'Before adding a new wait/subscription tool, introduce a semantic Room cursor distinct from game revision:\n',
    'The semantic Room cursor foundation is now implemented. Before adding a new wait/subscription tool, preserve the distinction from game revision:\n',
    "roadmap implemented cursor",
)
roadmap = replace_once(
    roadmap,
    'Implementation order:\n\n1. add persisted/backward-compatible `roomSeq` to GameRoom and all projections;\n2. centralize semantic state commits so write + sequence increment + broadcast cannot drift;\n3. add tests proving comment/Controller changes advance `roomSeq` without game revision and heartbeat-only writes do not;\n4. define a Human snapshot subscription endpoint—the current browser viewer WebSocket remains intentionally disabled because it exposes a different projection protocol;\n5. define bounded, cancellable `wait_for_room_update(afterRoomSeq, timeoutMs)` semantics for Advisors/local Apps;\n6. let the local bridge reuse one remote connection for multiple waiters sharing the same authorization/projection key;\n7. add waiter leases, single waiter per App, 30–60 second last-waiter grace, maximum idle TTL, reconnect jitter, and final cleanup on Room finish;\n8. use polling only as an explicitly bounded, stoppable fallback when push is unavailable.\n',
    '''Implemented foundation:

- persisted/backward-compatible `roomSeq` on GameRoom and all Human/Agent projections;
- centralized semantic commit path for write + sequence increment + conditional broadcast;
- regression tests proving game/comment/Controller/status events advance, heartbeat-only writes do not, and collection order is irrelevant.

Remaining implementation order:

1. define a Human snapshot subscription endpoint—the current browser viewer WebSocket remains intentionally disabled because it exposes a different projection protocol;
2. define bounded, cancellable `wait_for_room_update(afterRoomSeq, timeoutMs)` semantics for Advisors/local Apps;
3. let the local bridge reuse one remote connection for multiple waiters sharing the same authorization/projection key;
4. add waiter leases, single waiter per App, 30–60 second last-waiter grace, maximum idle TTL, reconnect jitter, and final cleanup on Room finish;
5. use polling only as an explicitly bounded, stoppable fallback when push is unavailable.
''',
    "roadmap sequence progress",
)
roadmap_path.write_text(roadmap)

manifest_path = Path("apps/web/public/agent.json")
manifest = json.loads(manifest_path.read_text())
cli = manifest["cli"]
if cli.get("candidateVersion") != "0.1.0-alpha.9" or cli.get("candidatePublished") is not False:
    raise SystemExit("agent.json must declare alpha.9 candidate before roomSeq update")
cli["candidateSummary"] = (
    "Human-vs-bots MCP Apps are response-driven with zero periodic reads; snapshots also add a semantic "
    "roomSeq cursor with centralized commit/broadcast rules, while subscription transport remains future work."
)
manifest["rooms"]["eventCursor"] = (
    "roomSeq is distinct from game revision; it advances for semantic client-visible Room changes but not heartbeat-only timestamps"
)
manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
