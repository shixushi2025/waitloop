import { DurableObject } from "cloudflare:workers";

import { GameRoomError, type GameMoveCommandV1 } from "@waitloop/game-core";

import {
  getRegisteredGame,
  type StoredGameRoom,
  type StoredGameSnapshot,
} from "./game-registry";
import {
  chooseHostedAgentMove,
  type HostedAgentEnv,
} from "./hosted-agent";
import type {
  GameActorBindingV1,
  GameActorRuntimeV1,
  GameActorV1,
  GameCapabilityV1,
  GameParticipantV1,
  GameRoomCommentV1,
  GameSeatRuntimeV1,
  GameSeatStatusV1,
  GameSeatV1,
  HostedAgentDescriptorV1,
  HostedAgentRuntimeStatsV1,
} from "./participants";
import {
  actorById,
  actorHasCapability,
  bindingForActor,
  canActorBecomeController,
  capabilitiesForActor,
  seatById,
  seatForActor,
  validateActorRoomModel,
} from "./room-actors";

export interface GameRoomEnv extends HostedAgentEnv {}

export type GameRoomPhaseV1 = "waiting_for_players" | "playing" | "paused" | "finished";

interface GameJoinStateV1 {
  version: 1;
  codeHash: string;
  actorId?: string | undefined;
  seatId?: string | undefined;
  // Legacy rooms stored only playerId. It was both actor and seat.
  playerId?: string | undefined;
  expiresAt: number;
  claimedAt?: number | undefined;
}

interface PersistedGameRoomV1 {
  version: 1;
  room: StoredGameRoom;
  botPlayerIds: string[];
  // Kept under the old storage key for migration safety; entries are actor IDs
  // in new rooms and player IDs (actor==seat) in old rooms.
  seatTokenHashes: Record<string, string>;
  viewerTokenHashes?: Record<string, string>;
  participants?: GameParticipantV1[];
  seatStates?: Record<string, GameSeatRuntimeV1>;
  actors?: GameActorV1[];
  seats?: GameSeatV1[];
  bindings?: GameActorBindingV1[];
  actorStates?: Record<string, GameActorRuntimeV1>;
  comments?: GameRoomCommentV1[];
  hostedAgents?: Record<string, HostedAgentDescriptorV1>;
  hostedAgentStats?: Record<string, HostedAgentRuntimeStatsV1>;
  roomPhase?: GameRoomPhaseV1;
  turnStartedAt?: number;
  join?: GameJoinStateV1;
}

interface NormalizedGameRoomV1 extends PersistedGameRoomV1 {
  viewerTokenHashes: Record<string, string>;
  actors: GameActorV1[];
  seats: GameSeatV1[];
  bindings: GameActorBindingV1[];
  actorStates: Record<string, GameActorRuntimeV1>;
  comments: GameRoomCommentV1[];
  hostedAgents: Record<string, HostedAgentDescriptorV1>;
  hostedAgentStats: Record<string, HostedAgentRuntimeStatsV1>;
  roomPhase: GameRoomPhaseV1;
  turnStartedAt: number;
}

interface SocketAttachmentV1 {
  version: 1;
  actorId: string;
}

export type GameRoomSnapshotV1 = StoredGameSnapshot & {
  // Legacy projections remain during the public browser migration.
  participants: GameParticipantV1[];
  seatStates: GameSeatRuntimeV1[];
  actors: GameActorV1[];
  seats: GameSeatV1[];
  bindings: GameActorBindingV1[];
  actorStates: GameActorRuntimeV1[];
  comments: GameRoomCommentV1[];
  viewerActorId: string;
  viewerSeatId: string;
  capabilities: GameCapabilityV1[];
  hostedAgentStats: HostedAgentRuntimeStatsV1[];
  roomPhase: GameRoomPhaseV1;
  turnStartedAt: number;
};

export interface GameJoinInfoV1 {
  version: 1;
  roomId: string;
  gameId: string;
  phase: GameRoomPhaseV1;
  actorId: string;
  seatId: string;
  playerId: string;
  relation: GameActorBindingV1["relation"];
  seatStatus: GameSeatStatusV1;
  expiresAt: number;
  claimedAt?: number;
}

interface GameSocketMessageV1 {
  version: 1;
  type: "game.snapshot";
  snapshot: GameRoomSnapshotV1;
}

export type GameRoomRpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } };

export interface InitializeGameRoomRequest {
  roomId: string;
  gameId: string;
  gameInput: unknown;
  // Legacy name. For new rooms this identifies the actor receiving the initial
  // snapshot; viewerActorId is preferred when actor and seat IDs differ.
  viewerId: string;
  viewerActorId?: string;
  botPlayerIds: string[];
  seatTokens?: Record<string, string>;
  viewerTokens?: Record<string, string>;
  participants?: GameParticipantV1[];
  actors?: GameActorV1[];
  seats?: GameSeatV1[];
  bindings?: GameActorBindingV1[];
  hostedAgents?: Record<string, HostedAgentDescriptorV1>;
  waitForSeatPlayerId?: string;
  waitForActorId?: string;
  join?: {
    version: 1;
    codeHash: string;
    actorId?: string | undefined;
    seatId?: string | undefined;
    playerId?: string | undefined;
    expiresAt: number;
  };
}

const STATE_KEY = "game-room-v1";
const MAX_AUTOMATED_MOVES = 8;
const MAX_COMMENTS = 50;

function failure(error: unknown): GameRoomRpcResult<never> {
  if (error instanceof GameRoomError) {
    return { ok: false, error: { code: error.code, message: error.message } };
  }
  if (error instanceof Error) {
    return { ok: false, error: { code: "invalid_game_state", message: error.message } };
  }
  return { ok: false, error: { code: "invalid_game_state", message: "Unknown game error." } };
}

function denied(code: string, message: string): GameRoomRpcResult<never> {
  return { ok: false, error: { code, message } };
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function phaseFromRoom(room: StoredGameRoom): GameRoomPhaseV1 {
  if (room.status === "paused") return "paused";
  if (room.status === "finished") return "finished";
  return "playing";
}

function legacyActorModel(state: PersistedGameRoomV1): {
  actors: GameActorV1[];
  seats: GameSeatV1[];
  bindings: GameActorBindingV1[];
  actorStates: Record<string, GameActorRuntimeV1>;
} {
  const actors = [...(state.participants ?? [])];
  const seats = actors.map((actor) => ({
    version: 1 as const,
    id: actor.id,
    label: actor.label,
    ownerActorId: actor.id,
    activeControllerActorId: actor.id,
  }));
  const bindings = actors.map((actor) => ({
    version: 1 as const,
    actorId: actor.id,
    seatId: actor.id,
    relation: "controller" as const,
  }));
  const actorStates: Record<string, GameActorRuntimeV1> = {};
  for (const actor of actors) {
    const legacy = state.seatStates?.[actor.id];
    actorStates[actor.id] = legacy
      ? {
          version: 1,
          actorId: actor.id,
          status: legacy.status,
          statusChangedAt: legacy.statusChangedAt,
          ...(legacy.connectedAt === undefined ? {} : { connectedAt: legacy.connectedAt }),
        }
      : {
          version: 1,
          actorId: actor.id,
          status: "ready",
          statusChangedAt: state.turnStartedAt ?? 0,
        };
  }
  return { actors, seats, bindings, actorStates };
}

function normalizeJoin(join: GameJoinStateV1 | undefined): GameJoinStateV1 | undefined {
  if (!join) return undefined;
  const actorId = join.actorId ?? join.playerId;
  const seatId = join.seatId ?? join.playerId;
  if (!actorId || !seatId) return join;
  return { ...join, actorId, seatId, playerId: seatId };
}

function normalizeState(state: PersistedGameRoomV1): NormalizedGameRoomV1 {
  const legacy = legacyActorModel(state);
  const actors = state.actors ? state.actors.map((actor) => ({ ...actor })) : legacy.actors;
  const seats = state.seats ? state.seats.map((seat) => ({ ...seat })) : legacy.seats;
  const bindings = state.bindings ? state.bindings.map((binding) => ({ ...binding })) : legacy.bindings;
  const actorStates = state.actorStates
    ? Object.fromEntries(Object.entries(state.actorStates).map(([id, value]) => [id, { ...value }]))
    : legacy.actorStates;

  for (const actor of actors) {
    if (!actorStates[actor.id]) {
      actorStates[actor.id] = {
        version: 1,
        actorId: actor.id,
        status: "ready",
        statusChangedAt: state.turnStartedAt ?? 0,
      };
    }
  }

  validateActorRoomModel({ actors, seats, bindings, actorStates });
  return {
    ...state,
    viewerTokenHashes: { ...(state.viewerTokenHashes ?? {}) },
    actors,
    seats,
    bindings,
    actorStates,
    comments: [...(state.comments ?? [])],
    hostedAgents: { ...(state.hostedAgents ?? {}) },
    hostedAgentStats: { ...(state.hostedAgentStats ?? {}) },
    roomPhase: state.roomPhase ?? phaseFromRoom(state.room),
    turnStartedAt: state.turnStartedAt ?? 0,
    ...(normalizeJoin(state.join) ? { join: normalizeJoin(state.join)! } : {}),
  };
}

function fallbackMove(snapshot: StoredGameSnapshot) {
  return snapshot.legalMoves.find((candidate) => candidate.id !== "pass") ?? snapshot.legalMoves[0];
}

function synchronizePhase(state: NormalizedGameRoomV1): NormalizedGameRoomV1 {
  if (state.roomPhase === "waiting_for_players") return state;
  return { ...state, roomPhase: phaseFromRoom(state.room) };
}

function legacyParticipants(state: NormalizedGameRoomV1): GameParticipantV1[] {
  return state.seats.map((seat) => actorById(state, seat.ownerActorId)).filter((actor): actor is GameActorV1 => actor !== null);
}

function legacySeatStates(state: NormalizedGameRoomV1): GameSeatRuntimeV1[] {
  return state.seats.map((seat) => {
    const runtime = state.actorStates[seat.activeControllerActorId] ?? state.actorStates[seat.ownerActorId];
    return {
      version: 1,
      playerId: seat.id,
      status: runtime?.status ?? "ready",
      statusChangedAt: runtime?.statusChangedAt ?? 0,
      ...(runtime?.connectedAt === undefined ? {} : { connectedAt: runtime.connectedAt }),
    };
  });
}

export class GameRoom extends DurableObject<GameRoomEnv> {
  private readonly runtimeEnv: GameRoomEnv;

  constructor(ctx: DurableObjectState, env: GameRoomEnv) {
    super(ctx, env);
    this.runtimeEnv = env;
  }

  private async readState(): Promise<NormalizedGameRoomV1 | null> {
    const state = (await this.ctx.storage.get<PersistedGameRoomV1>(STATE_KEY)) ?? null;
    return state ? normalizeState(state) : null;
  }

  private async writeState(state: NormalizedGameRoomV1): Promise<void> {
    await this.ctx.storage.put(STATE_KEY, state);
  }

  private resolveActorForLegacyViewer(state: NormalizedGameRoomV1, value: string): string | null {
    if (actorById(state, value)) return value;
    const seat = seatById(state, value);
    return seat?.ownerActorId ?? null;
  }

  private snapshot(state: NormalizedGameRoomV1, actorId: string): GameRoomSnapshotV1 {
    const binding = bindingForActor(state, actorId);
    if (!binding) throw new GameRoomError("viewer_not_in_room", "Viewer is not bound to a seat in this room.");
    const base = getRegisteredGame(state.room.gameId).snapshot(state.room, binding.seatId);
    const waiting = state.roomPhase === "waiting_for_players";
    return {
      ...base,
      currentPlayerId: waiting ? null : base.currentPlayerId,
      legalMoves: waiting ? [] : base.legalMoves,
      participants: legacyParticipants(state),
      seatStates: legacySeatStates(state),
      actors: state.actors.map((actor) => ({ ...actor })),
      seats: state.seats.map((seat) => ({ ...seat })),
      bindings: state.bindings.map((item) => ({ ...item })),
      actorStates: Object.values(state.actorStates).map((item) => ({ ...item })),
      comments: state.comments.map((comment) => ({ ...comment })),
      viewerActorId: actorId,
      viewerSeatId: binding.seatId,
      capabilities: capabilitiesForActor(state, actorId),
      hostedAgentStats: Object.values(state.hostedAgentStats).map((stats) => ({ ...stats })),
      roomPhase: state.roomPhase,
      turnStartedAt: state.turnStartedAt,
    };
  }

  private async resolveToken(tokenHashes: Record<string, string>, token: string): Promise<string | null> {
    if (token.length < 24 || token.length > 256) return null;
    const hash = await hashToken(token);
    for (const [actorId, expectedHash] of Object.entries(tokenHashes)) {
      if (constantTimeEqual(hash, expectedHash)) return actorId;
    }
    return null;
  }

  private resolveSeatToken(state: NormalizedGameRoomV1, token: string): Promise<string | null> {
    return this.resolveToken(state.seatTokenHashes, token);
  }

  private resolveViewer(state: NormalizedGameRoomV1, token: string): Promise<string | null> {
    return this.resolveToken(state.viewerTokenHashes, token);
  }

  private updateHostedStats(
    state: NormalizedGameRoomV1,
    playerId: string,
    decision: Awaited<ReturnType<typeof chooseHostedAgentMove>>,
    usedFallback: boolean,
  ): NormalizedGameRoomV1 {
    const current = state.hostedAgentStats[playerId] ?? {
      version: 1,
      playerId,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalLatencyMs: 0,
      fallbackMoves: 0,
    };
    const next: HostedAgentRuntimeStatsV1 = {
      version: 1,
      playerId,
      calls: current.calls + 1,
      inputTokens: current.inputTokens + decision.inputTokens,
      outputTokens: current.outputTokens + decision.outputTokens,
      totalLatencyMs: current.totalLatencyMs + decision.latencyMs,
      fallbackMoves: current.fallbackMoves + (usedFallback ? 1 : 0),
    };
    if (decision.error) next.lastError = decision.error;
    return { ...state, hostedAgentStats: { ...state.hostedAgentStats, [playerId]: next } };
  }

  private async runAutomatedPlayers(state: NormalizedGameRoomV1): Promise<NormalizedGameRoomV1> {
    if (state.roomPhase !== "playing") return state;
    let next = state;
    const initialRevision = next.room.revision;
    const game = getRegisteredGame(next.room.gameId);

    for (let step = 0; step < MAX_AUTOMATED_MOVES && next.room.status === "playing"; step += 1) {
      const probeSeatId = next.seats[0]?.id ?? next.botPlayerIds[0] ?? Object.keys(next.hostedAgents)[0];
      if (!probeSeatId) break;
      const currentPlayerId = game.snapshot(next.room, probeSeatId).currentPlayerId;
      if (!currentPlayerId) break;

      if (next.botPlayerIds.includes(currentPlayerId)) {
        const botSnapshot = game.snapshot(next.room, currentPlayerId);
        const move = fallbackMove(botSnapshot);
        if (!move) break;
        next = {
          ...next,
          room: game.applyMove(next.room, {
            version: 1,
            roomId: next.room.roomId,
            playerId: currentPlayerId,
            expectedRevision: next.room.revision,
            moveId: move.id,
          }),
        };
        continue;
      }

      const hostedAgent = next.hostedAgents[currentPlayerId];
      if (!hostedAgent) break;
      const hostedSnapshot = game.snapshot(next.room, currentPlayerId);
      const decision = await chooseHostedAgentMove(this.runtimeEnv, hostedAgent, hostedSnapshot);
      const selected = decision.ok && decision.moveId
        ? hostedSnapshot.legalMoves.find((move) => move.id === decision.moveId)
        : undefined;
      const move = selected ?? fallbackMove(hostedSnapshot);
      if (!move) break;
      next = this.updateHostedStats(next, currentPlayerId, decision, selected === undefined);
      next = {
        ...next,
        room: game.applyMove(next.room, {
          version: 1,
          roomId: next.room.roomId,
          playerId: currentPlayerId,
          expectedRevision: next.room.revision,
          moveId: move.id,
        }),
      };
    }

    if (next.room.revision !== initialRevision) next = { ...next, turnStartedAt: Date.now() };
    return synchronizePhase(next);
  }

  private async sendSnapshot(ws: WebSocket): Promise<void> {
    const attachment = ws.deserializeAttachment() as SocketAttachmentV1 | null;
    if (!attachment || attachment.version !== 1 || typeof attachment.actorId !== "string") {
      ws.close(1008, "Missing actor context.");
      return;
    }
    const state = await this.readState();
    if (!state) {
      ws.close(1008, "Room is not initialized.");
      return;
    }
    try {
      const message: GameSocketMessageV1 = {
        version: 1,
        type: "game.snapshot",
        snapshot: this.snapshot(state, attachment.actorId),
      };
      ws.send(JSON.stringify(message));
    } catch {
      ws.close(1008, "Actor is not authorized for this room.");
    }
  }

  private async broadcast(state: NormalizedGameRoomV1): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as SocketAttachmentV1 | null;
      if (!attachment || attachment.version !== 1) continue;
      try {
        ws.send(JSON.stringify({
          version: 1,
          type: "game.snapshot",
          snapshot: this.snapshot(state, attachment.actorId),
        } satisfies GameSocketMessageV1));
      } catch {
        try {
          ws.close(1008, "Actor is not authorized for this room.");
        } catch {
          // Stale sockets never block authoritative state transitions.
        }
      }
    }
  }

  async initialize(request: InitializeGameRoomRequest): Promise<GameRoomRpcResult<GameRoomSnapshotV1>> {
    try {
      if (await this.readState()) return denied("room_exists", "Game room is already initialized.");
      if (request.botPlayerIds.length > 2 || new Set(request.botPlayerIds).size !== request.botPlayerIds.length) {
        return denied("invalid_bots", "botPlayerIds must be unique and contain at most two seats.");
      }

      const game = getRegisteredGame(request.gameId);
      let room = game.create(request.roomId, request.gameInput);
      const legacyActors = request.participants ?? [];
      const actors = request.actors ?? legacyActors;
      const seats = request.seats ?? legacyActors.map((actor) => ({
        version: 1 as const,
        id: actor.id,
        label: actor.label,
        ownerActorId: actor.id,
        activeControllerActorId: actor.id,
      }));
      const bindings = request.bindings ?? legacyActors.map((actor) => ({
        version: 1 as const,
        actorId: actor.id,
        seatId: actor.id,
        relation: "controller" as const,
      }));
      const now = Date.now();
      const actorStates: Record<string, GameActorRuntimeV1> = {};
      const waitForActorId = request.waitForActorId ?? request.waitForSeatPlayerId;
      for (const actor of actors) {
        actorStates[actor.id] = {
          version: 1,
          actorId: actor.id,
          status: waitForActorId === actor.id ? "waiting" : "ready",
          statusChangedAt: now,
        };
      }
      validateActorRoomModel({ actors, seats, bindings, actorStates });
      for (const seat of seats) game.snapshot(room, seat.id);
      for (const botId of request.botPlayerIds) {
        if (!seatById({ seats }, botId)) throw new Error(`Unknown bot seat ${botId}.`);
      }

      const seatTokenHashes: Record<string, string> = {};
      for (const [actorId, token] of Object.entries(request.seatTokens ?? {})) {
        if (!actorById({ actors }, actorId)) throw new Error(`Unknown seat-token actor ${actorId}.`);
        seatTokenHashes[actorId] = await hashToken(token);
      }
      const viewerTokenHashes: Record<string, string> = {};
      for (const [actorId, token] of Object.entries(request.viewerTokens ?? {})) {
        if (!actorById({ actors }, actorId)) throw new Error(`Unknown viewer actor ${actorId}.`);
        viewerTokenHashes[actorId] = await hashToken(token);
      }

      const hostedAgents = { ...(request.hostedAgents ?? {}) };
      for (const seatId of Object.keys(hostedAgents)) {
        if (!seatById({ seats }, seatId)) throw new Error(`Unknown hosted-agent seat ${seatId}.`);
        if (request.botPlayerIds.includes(seatId)) throw new Error("Hosted-agent seats cannot also be bot seats.");
      }

      const viewerActorId = request.viewerActorId ?? request.viewerId;
      if (!actorById({ actors }, viewerActorId)) throw new Error("Initial viewer actor is not in this room.");

      const join = request.join
        ? {
            ...request.join,
            actorId: request.join.actorId ?? request.join.playerId,
            seatId: request.join.seatId ?? request.join.playerId,
            playerId: request.join.seatId ?? request.join.playerId,
          }
        : undefined;
      if (join) {
        if (!join.actorId || !join.seatId) throw new Error("Join state must identify an actor and seat.");
        if (join.actorId !== waitForActorId) throw new Error("join.actorId must match waitForActorId.");
        const binding = bindingForActor({ bindings }, join.actorId);
        if (binding?.seatId !== join.seatId) throw new Error("Join actor must be bound to the join seat.");
      }

      const waitingForPlayers = typeof waitForActorId === "string";
      if (waitingForPlayers) room = game.pause(room);
      let state: NormalizedGameRoomV1 = {
        version: 1,
        room,
        botPlayerIds: [...request.botPlayerIds],
        seatTokenHashes,
        viewerTokenHashes,
        actors: actors.map((actor) => ({ ...actor })),
        seats: seats.map((seat) => ({ ...seat })),
        bindings: bindings.map((binding) => ({ ...binding })),
        actorStates,
        comments: [],
        hostedAgents,
        hostedAgentStats: {},
        roomPhase: waitingForPlayers ? "waiting_for_players" : phaseFromRoom(room),
        turnStartedAt: now,
        ...(join ? { join } : {}),
      };
      state = await this.runAutomatedPlayers(state);
      await this.writeState(state);
      return { ok: true, value: this.snapshot(state, viewerActorId) };
    } catch (error) {
      return failure(error);
    }
  }

  async getJoinInfo(joinCodeHash: string): Promise<GameRoomRpcResult<GameJoinInfoV1>> {
    try {
      const state = await this.readState();
      const join = normalizeJoin(state?.join);
      if (!state || !join?.actorId || !join.seatId) return denied("join_not_found", "Join code does not identify an active actor.");
      if (!constantTimeEqual(join.codeHash, joinCodeHash)) return denied("join_not_found", "Join code does not identify an active actor.");
      const runtime = state.actorStates[join.actorId];
      const binding = bindingForActor(state, join.actorId);
      if (!runtime || !binding) return denied("join_not_found", "Join actor is unavailable.");
      const value: GameJoinInfoV1 = {
        version: 1,
        roomId: state.room.roomId,
        gameId: state.room.gameId,
        phase: state.roomPhase,
        actorId: join.actorId,
        seatId: join.seatId,
        playerId: join.seatId,
        relation: binding.relation,
        seatStatus: runtime.status,
        expiresAt: join.expiresAt,
      };
      if (join.claimedAt !== undefined) value.claimedAt = join.claimedAt;
      return { ok: true, value };
    } catch (error) {
      return failure(error);
    }
  }

  async claimJoinSeat(joinCodeHash: string, seatToken: string): Promise<GameRoomRpcResult<GameJoinInfoV1>> {
    try {
      const state = await this.readState();
      const join = normalizeJoin(state?.join);
      if (!state || !join?.actorId || !join.seatId || !constantTimeEqual(join.codeHash, joinCodeHash)) {
        return denied("join_not_found", "Join code does not identify an active actor.");
      }
      if (Date.now() > join.expiresAt) return denied("join_expired", "This join code has expired.");
      if (state.roomPhase !== "waiting_for_players") return denied("seat_already_connected", "The joined actor is already active.");
      if (join.claimedAt !== undefined) return denied("join_already_claimed", "This join code has already issued an actor credential.");
      if (seatToken.length < 24 || seatToken.length > 256) throw new Error("Seat token has invalid length.");

      const now = Date.now();
      const next: NormalizedGameRoomV1 = {
        ...state,
        seatTokenHashes: { ...state.seatTokenHashes, [join.actorId]: await hashToken(seatToken) },
        actorStates: {
          ...state.actorStates,
          [join.actorId]: {
            version: 1,
            actorId: join.actorId,
            status: "connecting",
            statusChangedAt: now,
          },
        },
        join: { ...join, claimedAt: now },
      };
      await this.writeState(next);
      await this.broadcast(next);
      return this.getJoinInfo(joinCodeHash);
    } catch (error) {
      return failure(error);
    }
  }

  async connectSeatByToken(seatToken: string): Promise<GameRoomRpcResult<GameRoomSnapshotV1>> {
    try {
      const state = await this.readState();
      if (!state) return denied("room_not_found", "Game room is not initialized.");
      const actorId = await this.resolveSeatToken(state, seatToken);
      if (!actorId) return denied("invalid_seat_token", "Seat token is invalid.");
      const runtime = state.actorStates[actorId];
      if (runtime?.status === "connected" && state.roomPhase !== "waiting_for_players") {
        return { ok: true, value: this.snapshot(state, actorId) };
      }

      const now = Date.now();
      let next: NormalizedGameRoomV1 = {
        ...state,
        actorStates: {
          ...state.actorStates,
          [actorId]: {
            version: 1,
            actorId,
            status: "connected",
            statusChangedAt: now,
            connectedAt: runtime?.connectedAt ?? now,
          },
        },
      };
      if (next.roomPhase === "waiting_for_players") {
        const game = getRegisteredGame(next.room.gameId);
        next = {
          ...next,
          room: game.resume(next.room),
          roomPhase: "playing",
          turnStartedAt: now,
        };
        next = await this.runAutomatedPlayers(next);
      }
      await this.writeState(next);
      await this.broadcast(next);
      return { ok: true, value: this.snapshot(next, actorId) };
    } catch (error) {
      return failure(error);
    }
  }

  async getSnapshot(viewerId: string): Promise<GameRoomRpcResult<GameRoomSnapshotV1>> {
    try {
      const state = await this.readState();
      if (!state) return denied("room_not_found", "Game room is not initialized.");
      const actorId = this.resolveActorForLegacyViewer(state, viewerId);
      if (!actorId) return denied("viewer_not_in_room", "Viewer is not in this room.");
      return { ok: true, value: this.snapshot(state, actorId) };
    } catch (error) {
      return failure(error);
    }
  }

  async getSnapshotByViewerToken(viewerToken: string): Promise<GameRoomRpcResult<GameRoomSnapshotV1>> {
    try {
      const state = await this.readState();
      if (!state) return denied("room_not_found", "Game room is not initialized.");
      const actorId = await this.resolveViewer(state, viewerToken);
      if (!actorId) return denied("invalid_viewer_token", "Room viewer credential is invalid.");
      return { ok: true, value: this.snapshot(state, actorId) };
    } catch (error) {
      return failure(error);
    }
  }

  async getSnapshotBySeatToken(seatToken: string): Promise<GameRoomRpcResult<GameRoomSnapshotV1>> {
    try {
      const state = await this.readState();
      if (!state) return denied("room_not_found", "Game room is not initialized.");
      const actorId = await this.resolveSeatToken(state, seatToken);
      if (!actorId) return denied("invalid_seat_token", "Seat token is invalid.");
      return { ok: true, value: this.snapshot(state, actorId) };
    } catch (error) {
      return failure(error);
    }
  }

  private async applySeatMove(
    state: NormalizedGameRoomV1,
    seatId: string,
    expectedRevision: number,
    moveId: string,
  ): Promise<NormalizedGameRoomV1> {
    const game = getRegisteredGame(state.room.gameId);
    const moved = game.applyMove(state.room, {
      version: 1,
      roomId: state.room.roomId,
      playerId: seatId,
      expectedRevision,
      moveId,
    });
    return this.runAutomatedPlayers({ ...state, room: moved, roomPhase: phaseFromRoom(moved), turnStartedAt: Date.now() });
  }

  private async applyActorMove(
    state: NormalizedGameRoomV1,
    actorId: string,
    expectedRevision: number,
    moveId: string,
  ): Promise<GameRoomRpcResult<NormalizedGameRoomV1>> {
    if (!actorHasCapability(state, actorId, "seat:play")) {
      return denied("not_active_controller", "This actor can inspect the seat but is not its active controller.");
    }
    const seat = seatForActor(state, actorId);
    if (!seat) return denied("actor_not_bound", "Actor is not bound to a playable seat.");
    return { ok: true, value: await this.applySeatMove(state, seat.id, expectedRevision, moveId) };
  }

  async applyMove(command: GameMoveCommandV1, viewerId: string): Promise<GameRoomRpcResult<GameRoomSnapshotV1>> {
    try {
      const state = await this.readState();
      if (!state) return denied("room_not_found", "Game room is not initialized.");
      const next = await this.applySeatMove(state, command.playerId, command.expectedRevision, command.moveId);
      await this.writeState(next);
      await this.broadcast(next);
      const actorId = this.resolveActorForLegacyViewer(next, viewerId);
      if (!actorId) return denied("viewer_not_in_room", "Viewer is not in this room.");
      return { ok: true, value: this.snapshot(next, actorId) };
    } catch (error) {
      return failure(error);
    }
  }

  async applyMoveByViewerToken(viewerToken: string, expectedRevision: number, moveId: string): Promise<GameRoomRpcResult<GameRoomSnapshotV1>> {
    try {
      const state = await this.readState();
      if (!state) return denied("room_not_found", "Game room is not initialized.");
      const actorId = await this.resolveViewer(state, viewerToken);
      if (!actorId) return denied("invalid_viewer_token", "Room viewer credential is invalid.");
      const moved = await this.applyActorMove(state, actorId, expectedRevision, moveId);
      if (!moved.ok) return moved;
      await this.writeState(moved.value);
      await this.broadcast(moved.value);
      return { ok: true, value: this.snapshot(moved.value, actorId) };
    } catch (error) {
      return failure(error);
    }
  }

  async applyMoveBySeatToken(seatToken: string, expectedRevision: number, moveId: string): Promise<GameRoomRpcResult<GameRoomSnapshotV1>> {
    try {
      const state = await this.readState();
      if (!state) return denied("room_not_found", "Game room is not initialized.");
      const actorId = await this.resolveSeatToken(state, seatToken);
      if (!actorId) return denied("invalid_seat_token", "Seat token is invalid.");
      const moved = await this.applyActorMove(state, actorId, expectedRevision, moveId);
      if (!moved.ok) return moved;
      await this.writeState(moved.value);
      await this.broadcast(moved.value);
      return { ok: true, value: this.snapshot(moved.value, actorId) };
    } catch (error) {
      return failure(error);
    }
  }

  async setControllerByViewerToken(viewerToken: string, targetActorId: string): Promise<GameRoomRpcResult<GameRoomSnapshotV1>> {
    try {
      const state = await this.readState();
      if (!state) return denied("room_not_found", "Game room is not initialized.");
      const ownerActorId = await this.resolveViewer(state, viewerToken);
      if (!ownerActorId) return denied("invalid_viewer_token", "Room viewer credential is invalid.");
      const seat = seatForActor(state, ownerActorId);
      if (!seat || seat.ownerActorId !== ownerActorId) return denied("not_seat_owner", "Only the seat owner may change its controller.");
      if (!canActorBecomeController(state, seat.id, targetActorId)) return denied("invalid_controller", "Target actor is not bound to this seat.");
      const actor = actorById(state, targetActorId);
      const runtime = state.actorStates[targetActorId];
      if (actor?.kind === "connected-agent" && runtime?.status !== "connected") {
        return denied("controller_not_ready", "Connected agent must be online before it can control the seat.");
      }
      const next: NormalizedGameRoomV1 = {
        ...state,
        seats: state.seats.map((item) => item.id === seat.id ? { ...item, activeControllerActorId: targetActorId } : item),
      };
      await this.writeState(next);
      await this.broadcast(next);
      return { ok: true, value: this.snapshot(next, ownerActorId) };
    } catch (error) {
      return failure(error);
    }
  }

  async addCommentBySeatToken(seatToken: string, text: string): Promise<GameRoomRpcResult<GameRoomSnapshotV1>> {
    try {
      const state = await this.readState();
      if (!state) return denied("room_not_found", "Game room is not initialized.");
      const actorId = await this.resolveSeatToken(state, seatToken);
      if (!actorId) return denied("invalid_seat_token", "Seat token is invalid.");
      if (!actorHasCapability(state, actorId, "room:comment")) return denied("comment_forbidden", "Actor cannot comment in this room.");
      const value = text.trim();
      if (value.length === 0 || value.length > 280) return denied("invalid_comment", "Comment must contain 1 to 280 characters.");
      const comment: GameRoomCommentV1 = {
        version: 1,
        id: `comment-${crypto.randomUUID()}`,
        actorId,
        text: value,
        createdAt: Date.now(),
      };
      const next: NormalizedGameRoomV1 = { ...state, comments: [...state.comments, comment].slice(-MAX_COMMENTS) };
      await this.writeState(next);
      await this.broadcast(next);
      return { ok: true, value: this.snapshot(next, actorId) };
    } catch (error) {
      return failure(error);
    }
  }

  private async pauseState(state: NormalizedGameRoomV1): Promise<NormalizedGameRoomV1> {
    if (state.roomPhase === "waiting_for_players" || state.roomPhase === "finished") return state;
    const game = getRegisteredGame(state.room.gameId);
    const room = game.pause(state.room);
    return { ...state, room, roomPhase: phaseFromRoom(room) };
  }

  private async resumeState(state: NormalizedGameRoomV1): Promise<NormalizedGameRoomV1> {
    if (state.roomPhase === "waiting_for_players" || state.roomPhase === "finished") return state;
    const game = getRegisteredGame(state.room.gameId);
    const room = game.resume(state.room);
    return this.runAutomatedPlayers({ ...state, room, roomPhase: phaseFromRoom(room), turnStartedAt: Date.now() });
  }

  async pause(viewerId: string): Promise<GameRoomRpcResult<GameRoomSnapshotV1>> {
    try {
      const state = await this.readState();
      if (!state) return denied("room_not_found", "Game room is not initialized.");
      const actorId = this.resolveActorForLegacyViewer(state, viewerId);
      if (!actorId) return denied("viewer_not_in_room", "Viewer is not in this room.");
      const next = await this.pauseState(state);
      await this.writeState(next);
      await this.broadcast(next);
      return { ok: true, value: this.snapshot(next, actorId) };
    } catch (error) {
      return failure(error);
    }
  }

  async pauseByViewerToken(viewerToken: string): Promise<GameRoomRpcResult<GameRoomSnapshotV1>> {
    try {
      const state = await this.readState();
      if (!state) return denied("room_not_found", "Game room is not initialized.");
      const actorId = await this.resolveViewer(state, viewerToken);
      if (!actorId) return denied("invalid_viewer_token", "Room viewer credential is invalid.");
      const next = await this.pauseState(state);
      await this.writeState(next);
      await this.broadcast(next);
      return { ok: true, value: this.snapshot(next, actorId) };
    } catch (error) {
      return failure(error);
    }
  }

  async resume(viewerId: string): Promise<GameRoomRpcResult<GameRoomSnapshotV1>> {
    try {
      const state = await this.readState();
      if (!state) return denied("room_not_found", "Game room is not initialized.");
      const actorId = this.resolveActorForLegacyViewer(state, viewerId);
      if (!actorId) return denied("viewer_not_in_room", "Viewer is not in this room.");
      const next = await this.resumeState(state);
      await this.writeState(next);
      await this.broadcast(next);
      return { ok: true, value: this.snapshot(next, actorId) };
    } catch (error) {
      return failure(error);
    }
  }

  async resumeByViewerToken(viewerToken: string): Promise<GameRoomRpcResult<GameRoomSnapshotV1>> {
    try {
      const state = await this.readState();
      if (!state) return denied("room_not_found", "Game room is not initialized.");
      const actorId = await this.resolveViewer(state, viewerToken);
      if (!actorId) return denied("invalid_viewer_token", "Room viewer credential is invalid.");
      const next = await this.resumeState(state);
      await this.writeState(next);
      await this.broadcast(next);
      return { ok: true, value: this.snapshot(next, actorId) };
    } catch (error) {
      return failure(error);
    }
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.method !== "GET" || request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade.", { status: 426 });
    }
    const state = await this.readState();
    if (!state) return new Response("Room not found.", { status: 404 });

    const viewerToken = request.headers.get("x-waitloop-viewer-token");
    let actorId: string | null = null;
    if (viewerToken) actorId = await this.resolveViewer(state, viewerToken);
    if (!actorId) {
      const legacyViewerId = new URL(request.url).searchParams.get("viewer");
      if (legacyViewerId) actorId = this.resolveActorForLegacyViewer(state, legacyViewerId);
    }
    if (!actorId) return new Response("Actor is not authorized for this room.", { status: 403 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment({ version: 1, actorId } satisfies SocketAttachmentV1);
    this.ctx.acceptWebSocket(server);
    await this.sendSnapshot(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, _message: string | ArrayBuffer): Promise<void> {
    await this.sendSnapshot(ws);
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): Promise<void> {
    ws.close(code, reason);
  }
}
