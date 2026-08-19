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
  GameParticipantV1,
  GameSeatRuntimeV1,
  HostedAgentDescriptorV1,
  HostedAgentRuntimeStatsV1,
} from "./participants";

export interface GameRoomEnv extends HostedAgentEnv {}

export type GameRoomPhaseV1 = "waiting_for_players" | "playing" | "paused" | "finished";

interface GameJoinStateV1 {
  version: 1;
  codeHash: string;
  playerId: string;
  expiresAt: number;
  claimedAt?: number;
}

interface PersistedGameRoomV1 {
  version: 1;
  room: StoredGameRoom;
  botPlayerIds: string[];
  seatTokenHashes: Record<string, string>;
  viewerTokenHashes?: Record<string, string>;
  participants?: GameParticipantV1[];
  hostedAgents?: Record<string, HostedAgentDescriptorV1>;
  hostedAgentStats?: Record<string, HostedAgentRuntimeStatsV1>;
  roomPhase?: GameRoomPhaseV1;
  seatStates?: Record<string, GameSeatRuntimeV1>;
  turnStartedAt?: number;
  join?: GameJoinStateV1;
}

interface NormalizedGameRoomV1 extends PersistedGameRoomV1 {
  viewerTokenHashes: Record<string, string>;
  participants: GameParticipantV1[];
  hostedAgents: Record<string, HostedAgentDescriptorV1>;
  hostedAgentStats: Record<string, HostedAgentRuntimeStatsV1>;
  roomPhase: GameRoomPhaseV1;
  seatStates: Record<string, GameSeatRuntimeV1>;
  turnStartedAt: number;
}

interface SocketAttachmentV1 {
  version: 1;
  viewerId: string;
}

export type GameRoomSnapshotV1 = StoredGameSnapshot & {
  participants: GameParticipantV1[];
  hostedAgentStats: HostedAgentRuntimeStatsV1[];
  roomPhase: GameRoomPhaseV1;
  seatStates: GameSeatRuntimeV1[];
  turnStartedAt: number;
};

export interface GameJoinInfoV1 {
  version: 1;
  roomId: string;
  gameId: string;
  phase: GameRoomPhaseV1;
  playerId: string;
  seatStatus: GameSeatRuntimeV1["status"];
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
  viewerId: string;
  botPlayerIds: string[];
  seatTokens?: Record<string, string>;
  viewerTokens?: Record<string, string>;
  participants?: GameParticipantV1[];
  hostedAgents?: Record<string, HostedAgentDescriptorV1>;
  waitForSeatPlayerId?: string;
  join?: {
    version: 1;
    codeHash: string;
    playerId: string;
    expiresAt: number;
  };
}

const STATE_KEY = "game-room-v1";
const MAX_AUTOMATED_MOVES = 8;

function failure(error: unknown): GameRoomRpcResult<never> {
  if (error instanceof GameRoomError) {
    return { ok: false, error: { code: error.code, message: error.message } };
  }
  if (error instanceof Error) {
    return { ok: false, error: { code: "invalid_game_state", message: error.message } };
  }
  return { ok: false, error: { code: "invalid_game_state", message: "Unknown game error." } };
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

function normalizeState(state: PersistedGameRoomV1): NormalizedGameRoomV1 {
  const participants = [...(state.participants ?? [])];
  const seatStates = { ...(state.seatStates ?? {}) };
  for (const participant of participants) {
    if (!seatStates[participant.id]) {
      seatStates[participant.id] = {
        version: 1,
        playerId: participant.id,
        status: "ready",
        statusChangedAt: state.turnStartedAt ?? 0,
      };
    }
  }

  return {
    ...state,
    viewerTokenHashes: { ...(state.viewerTokenHashes ?? {}) },
    participants,
    hostedAgents: { ...(state.hostedAgents ?? {}) },
    hostedAgentStats: { ...(state.hostedAgentStats ?? {}) },
    roomPhase: state.roomPhase ?? phaseFromRoom(state.room),
    seatStates,
    turnStartedAt: state.turnStartedAt ?? 0,
  };
}

function fallbackMove(snapshot: StoredGameSnapshot) {
  return snapshot.legalMoves.find((candidate) => candidate.id !== "pass") ?? snapshot.legalMoves[0];
}

function synchronizePhase(state: NormalizedGameRoomV1): NormalizedGameRoomV1 {
  if (state.roomPhase === "waiting_for_players") return state;
  return { ...state, roomPhase: phaseFromRoom(state.room) };
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

  private snapshot(state: NormalizedGameRoomV1, viewerId: string): GameRoomSnapshotV1 {
    const base = getRegisteredGame(state.room.gameId).snapshot(state.room, viewerId);
    const waiting = state.roomPhase === "waiting_for_players";
    return {
      ...base,
      currentPlayerId: waiting ? null : base.currentPlayerId,
      legalMoves: waiting ? [] : base.legalMoves,
      participants: state.participants.map((participant) => ({ ...participant })),
      hostedAgentStats: Object.values(state.hostedAgentStats).map((stats) => ({ ...stats })),
      roomPhase: state.roomPhase,
      seatStates: Object.values(state.seatStates).map((seat) => ({ ...seat })),
      turnStartedAt: state.turnStartedAt,
    };
  }

  private async resolveToken(
    tokenHashes: Record<string, string>,
    token: string,
  ): Promise<string | null> {
    if (token.length < 24 || token.length > 256) return null;
    const hash = await hashToken(token);

    for (const [playerId, expectedHash] of Object.entries(tokenHashes)) {
      if (constantTimeEqual(hash, expectedHash)) return playerId;
    }
    return null;
  }

  private resolveSeat(state: NormalizedGameRoomV1, token: string): Promise<string | null> {
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

    return {
      ...state,
      hostedAgentStats: {
        ...state.hostedAgentStats,
        [playerId]: next,
      },
    };
  }

  private async runAutomatedPlayers(state: NormalizedGameRoomV1): Promise<NormalizedGameRoomV1> {
    if (state.roomPhase !== "playing") return state;

    let next = state;
    const initialRevision = next.room.revision;
    const game = getRegisteredGame(next.room.gameId);

    for (let step = 0; step < MAX_AUTOMATED_MOVES && next.room.status === "playing"; step += 1) {
      const probePlayerId = next.participants[0]?.id ?? next.botPlayerIds[0] ?? Object.keys(next.hostedAgents)[0];
      if (!probePlayerId) break;

      const probe = game.snapshot(next.room, probePlayerId);
      const currentPlayerId = probe.currentPlayerId;
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

      const usedFallback = selected === undefined;
      next = this.updateHostedStats(next, currentPlayerId, decision, usedFallback);
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
    if (!attachment || attachment.version !== 1 || typeof attachment.viewerId !== "string") {
      ws.close(1008, "Missing viewer context.");
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
        snapshot: this.snapshot(state, attachment.viewerId),
      };
      ws.send(JSON.stringify(message));
    } catch {
      ws.close(1008, "Viewer is not authorized for this room.");
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
          snapshot: this.snapshot(state, attachment.viewerId),
        } satisfies GameSocketMessageV1));
      } catch {
        try {
          ws.close(1008, "Viewer is not authorized for this room.");
        } catch {
          // Stale sockets never block authoritative state transitions.
        }
      }
    }
  }

  async initialize(request: InitializeGameRoomRequest): Promise<GameRoomRpcResult<GameRoomSnapshotV1>> {
    try {
      if (await this.readState()) {
        return { ok: false, error: { code: "room_exists", message: "Game room is already initialized." } };
      }
      if (request.botPlayerIds.length > 2 || new Set(request.botPlayerIds).size !== request.botPlayerIds.length) {
        return { ok: false, error: { code: "invalid_bots", message: "botPlayerIds must be unique and contain at most two players." } };
      }

      const game = getRegisteredGame(request.gameId);
      let room = game.create(request.roomId, request.gameInput);
      game.snapshot(room, request.viewerId);
      for (const botId of request.botPlayerIds) game.snapshot(room, botId);

      const participants = request.participants ?? [];
      if (participants.length > 0) {
        if (participants.length !== 3 || new Set(participants.map((item) => item.id)).size !== participants.length) {
          throw new Error("participants must describe exactly three distinct players.");
        }
        for (const participant of participants) game.snapshot(room, participant.id);
      }

      const seatTokenHashes: Record<string, string> = {};
      for (const [playerId, token] of Object.entries(request.seatTokens ?? {})) {
        game.snapshot(room, playerId);
        if (request.botPlayerIds.includes(playerId)) throw new Error("Bot seats cannot receive MCP seat tokens.");
        seatTokenHashes[playerId] = await hashToken(token);
      }

      const viewerTokenHashes: Record<string, string> = {};
      for (const [playerId, token] of Object.entries(request.viewerTokens ?? {})) {
        game.snapshot(room, playerId);
        viewerTokenHashes[playerId] = await hashToken(token);
      }

      const hostedAgents = { ...(request.hostedAgents ?? {}) };
      for (const playerId of Object.keys(hostedAgents)) {
        game.snapshot(room, playerId);
        if (request.botPlayerIds.includes(playerId)) throw new Error("Hosted agent seats cannot also be bot seats.");
        if (seatTokenHashes[playerId]) throw new Error("Hosted agent seats cannot also be MCP-connected seats.");
      }

      const now = Date.now();
      const seatStates: Record<string, GameSeatRuntimeV1> = {};
      for (const participant of participants) {
        const waiting = request.waitForSeatPlayerId === participant.id;
        seatStates[participant.id] = {
          version: 1,
          playerId: participant.id,
          status: waiting ? "waiting" : "ready",
          statusChangedAt: now,
        };
      }

      if (request.join) {
        game.snapshot(room, request.join.playerId);
        if (request.join.playerId !== request.waitForSeatPlayerId) {
          throw new Error("join.playerId must match waitForSeatPlayerId.");
        }
      }

      const waitingForPlayers = typeof request.waitForSeatPlayerId === "string";
      if (waitingForPlayers) room = game.pause(room);

      let state: NormalizedGameRoomV1 = {
        version: 1,
        room,
        botPlayerIds: [...request.botPlayerIds],
        seatTokenHashes,
        viewerTokenHashes,
        participants: participants.map((participant) => ({ ...participant })),
        hostedAgents,
        hostedAgentStats: {},
        roomPhase: waitingForPlayers ? "waiting_for_players" : phaseFromRoom(room),
        seatStates,
        turnStartedAt: now,
        join: request.join ? { ...request.join } : undefined,
      };
      state = await this.runAutomatedPlayers(state);
      await this.writeState(state);
      return { ok: true, value: this.snapshot(state, request.viewerId) };
    } catch (error) {
      return failure(error);
    }
  }

  async getJoinInfo(joinCodeHash: string): Promise<GameRoomRpcResult<GameJoinInfoV1>> {
    try {
      const state = await this.readState();
      if (!state || !state.join) return { ok: false, error: { code: "join_not_found", message: "Join code does not identify an active agent seat." } };
      if (!constantTimeEqual(state.join.codeHash, joinCodeHash)) {
        return { ok: false, error: { code: "join_not_found", message: "Join code does not identify an active agent seat." } };
      }
      const seat = state.seatStates[state.join.playerId];
      if (!seat) return { ok: false, error: { code: "join_not_found", message: "Join seat is unavailable." } };

      const value: GameJoinInfoV1 = {
        version: 1,
        roomId: state.room.roomId,
        gameId: state.room.gameId,
        phase: state.roomPhase,
        playerId: state.join.playerId,
        seatStatus: seat.status,
        expiresAt: state.join.expiresAt,
      };
      if (state.join.claimedAt !== undefined) value.claimedAt = state.join.claimedAt;
      return { ok: true, value };
    } catch (error) {
      return failure(error);
    }
  }

  async claimJoinSeat(joinCodeHash: string, seatToken: string): Promise<GameRoomRpcResult<GameJoinInfoV1>> {
    try {
      const state = await this.readState();
      if (!state || !state.join || !constantTimeEqual(state.join.codeHash, joinCodeHash)) {
        return { ok: false, error: { code: "join_not_found", message: "Join code does not identify an active agent seat." } };
      }
      if (Date.now() > state.join.expiresAt) {
        return { ok: false, error: { code: "join_expired", message: "This join code has expired." } };
      }
      if (state.roomPhase !== "waiting_for_players") {
        return { ok: false, error: { code: "seat_already_connected", message: "The connected-agent seat is already active." } };
      }
      if (state.join.claimedAt !== undefined) {
        return { ok: false, error: { code: "join_already_claimed", message: "This join code has already issued a seat credential." } };
      }
      if (seatToken.length < 24 || seatToken.length > 256) throw new Error("Seat token has invalid length.");

      const now = Date.now();
      const playerId = state.join.playerId;
      const next: NormalizedGameRoomV1 = {
        ...state,
        seatTokenHashes: {
          ...state.seatTokenHashes,
          [playerId]: await hashToken(seatToken),
        },
        seatStates: {
          ...state.seatStates,
          [playerId]: {
            version: 1,
            playerId,
            status: "connecting",
            statusChangedAt: now,
          },
        },
        join: { ...state.join, claimedAt: now },
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
      if (!state) return { ok: false, error: { code: "room_not_found", message: "Game room is not initialized." } };
      const playerId = await this.resolveSeat(state, seatToken);
      if (!playerId) return { ok: false, error: { code: "invalid_seat_token", message: "Seat token is invalid." } };

      const seat = state.seatStates[playerId];
      if (seat?.status === "connected" && state.roomPhase !== "waiting_for_players") {
        return { ok: true, value: this.snapshot(state, playerId) };
      }

      const now = Date.now();
      let next: NormalizedGameRoomV1 = {
        ...state,
        seatStates: {
          ...state.seatStates,
          [playerId]: {
            version: 1,
            playerId,
            status: "connected",
            statusChangedAt: now,
            connectedAt: seat?.connectedAt ?? now,
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
      return { ok: true, value: this.snapshot(next, playerId) };
    } catch (error) {
      return failure(error);
    }
  }

  async getSnapshot(viewerId: string): Promise<GameRoomRpcResult<GameRoomSnapshotV1>> {
    try {
      const state = await this.readState();
      if (!state) return { ok: false, error: { code: "room_not_found", message: "Game room is not initialized." } };
      return { ok: true, value: this.snapshot(state, viewerId) };
    } catch (error) {
      return failure(error);
    }
  }

  async getSnapshotByViewerToken(viewerToken: string): Promise<GameRoomRpcResult<GameRoomSnapshotV1>> {
    try {
      const state = await this.readState();
      if (!state) return { ok: false, error: { code: "room_not_found", message: "Game room is not initialized." } };
      const playerId = await this.resolveViewer(state, viewerToken);
      if (!playerId) return { ok: false, error: { code: "invalid_viewer_token", message: "Room viewer credential is invalid." } };
      return { ok: true, value: this.snapshot(state, playerId) };
    } catch (error) {
      return failure(error);
    }
  }

  async getSnapshotBySeatToken(seatToken: string): Promise<GameRoomRpcResult<GameRoomSnapshotV1>> {
    try {
      const state = await this.readState();
      if (!state) return { ok: false, error: { code: "room_not_found", message: "Game room is not initialized." } };
      const playerId = await this.resolveSeat(state, seatToken);
      if (!playerId) return { ok: false, error: { code: "invalid_seat_token", message: "Seat token is invalid." } };
      return { ok: true, value: this.snapshot(state, playerId) };
    } catch (error) {
      return failure(error);
    }
  }

  private async applyPlayerMove(
    state: NormalizedGameRoomV1,
    playerId: string,
    expectedRevision: number,
    moveId: string,
  ): Promise<NormalizedGameRoomV1> {
    const game = getRegisteredGame(state.room.gameId);
    const moved = game.applyMove(state.room, {
      version: 1,
      roomId: state.room.roomId,
      playerId,
      expectedRevision,
      moveId,
    });
    return this.runAutomatedPlayers({
      ...state,
      room: moved,
      roomPhase: phaseFromRoom(moved),
      turnStartedAt: Date.now(),
    });
  }

  async applyMove(command: GameMoveCommandV1, viewerId: string): Promise<GameRoomRpcResult<GameRoomSnapshotV1>> {
    try {
      const state = await this.readState();
      if (!state) return { ok: false, error: { code: "room_not_found", message: "Game room is not initialized." } };
      const next = await this.applyPlayerMove(state, command.playerId, command.expectedRevision, command.moveId);
      await this.writeState(next);
      await this.broadcast(next);
      return { ok: true, value: this.snapshot(next, viewerId) };
    } catch (error) {
      return failure(error);
    }
  }

  async applyMoveByViewerToken(
    viewerToken: string,
    expectedRevision: number,
    moveId: string,
  ): Promise<GameRoomRpcResult<GameRoomSnapshotV1>> {
    try {
      const state = await this.readState();
      if (!state) return { ok: false, error: { code: "room_not_found", message: "Game room is not initialized." } };
      const playerId = await this.resolveViewer(state, viewerToken);
      if (!playerId) return { ok: false, error: { code: "invalid_viewer_token", message: "Room viewer credential is invalid." } };
      const next = await this.applyPlayerMove(state, playerId, expectedRevision, moveId);
      await this.writeState(next);
      await this.broadcast(next);
      return { ok: true, value: this.snapshot(next, playerId) };
    } catch (error) {
      return failure(error);
    }
  }

  async applyMoveBySeatToken(
    seatToken: string,
    expectedRevision: number,
    moveId: string,
  ): Promise<GameRoomRpcResult<GameRoomSnapshotV1>> {
    try {
      const state = await this.readState();
      if (!state) return { ok: false, error: { code: "room_not_found", message: "Game room is not initialized." } };
      const playerId = await this.resolveSeat(state, seatToken);
      if (!playerId) return { ok: false, error: { code: "invalid_seat_token", message: "Seat token is invalid." } };
      const next = await this.applyPlayerMove(state, playerId, expectedRevision, moveId);
      await this.writeState(next);
      await this.broadcast(next);
      return { ok: true, value: this.snapshot(next, playerId) };
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
    let next: NormalizedGameRoomV1 = {
      ...state,
      room,
      roomPhase: phaseFromRoom(room),
      turnStartedAt: Date.now(),
    };
    next = await this.runAutomatedPlayers(next);
    return next;
  }

  async pause(viewerId: string): Promise<GameRoomRpcResult<GameRoomSnapshotV1>> {
    try {
      const state = await this.readState();
      if (!state) return { ok: false, error: { code: "room_not_found", message: "Game room is not initialized." } };
      const next = await this.pauseState(state);
      await this.writeState(next);
      await this.broadcast(next);
      return { ok: true, value: this.snapshot(next, viewerId) };
    } catch (error) {
      return failure(error);
    }
  }

  async pauseByViewerToken(viewerToken: string): Promise<GameRoomRpcResult<GameRoomSnapshotV1>> {
    try {
      const state = await this.readState();
      if (!state) return { ok: false, error: { code: "room_not_found", message: "Game room is not initialized." } };
      const playerId = await this.resolveViewer(state, viewerToken);
      if (!playerId) return { ok: false, error: { code: "invalid_viewer_token", message: "Room viewer credential is invalid." } };
      const next = await this.pauseState(state);
      await this.writeState(next);
      await this.broadcast(next);
      return { ok: true, value: this.snapshot(next, playerId) };
    } catch (error) {
      return failure(error);
    }
  }

  async resume(viewerId: string): Promise<GameRoomRpcResult<GameRoomSnapshotV1>> {
    try {
      const state = await this.readState();
      if (!state) return { ok: false, error: { code: "room_not_found", message: "Game room is not initialized." } };
      const next = await this.resumeState(state);
      await this.writeState(next);
      await this.broadcast(next);
      return { ok: true, value: this.snapshot(next, viewerId) };
    } catch (error) {
      return failure(error);
    }
  }

  async resumeByViewerToken(viewerToken: string): Promise<GameRoomRpcResult<GameRoomSnapshotV1>> {
    try {
      const state = await this.readState();
      if (!state) return { ok: false, error: { code: "room_not_found", message: "Game room is not initialized." } };
      const playerId = await this.resolveViewer(state, viewerToken);
      if (!playerId) return { ok: false, error: { code: "invalid_viewer_token", message: "Room viewer credential is invalid." } };
      const next = await this.resumeState(state);
      await this.writeState(next);
      await this.broadcast(next);
      return { ok: true, value: this.snapshot(next, playerId) };
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
    let viewerId: string | null = null;
    if (viewerToken) viewerId = await this.resolveViewer(state, viewerToken);

    if (!viewerId) {
      const url = new URL(request.url);
      const legacyViewerId = url.searchParams.get("viewer");
      if (legacyViewerId) {
        try {
          this.snapshot(state, legacyViewerId);
          viewerId = legacyViewerId;
        } catch {
          viewerId = null;
        }
      }
    }

    if (!viewerId) return new Response("Viewer is not authorized for this room.", { status: 403 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment({ version: 1, viewerId } satisfies SocketAttachmentV1);
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
