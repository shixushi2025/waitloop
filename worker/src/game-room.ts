import { DurableObject } from "cloudflare:workers";

import { GameRoomError, type GameMoveCommandV1 } from "@waitloop/game-core";

import {
  getRegisteredGame,
  type StoredGameRoom,
  type StoredGameSnapshot,
} from "./game-registry";

export interface GameRoomEnv {}

interface PersistedGameRoomV1 {
  version: 1;
  room: StoredGameRoom;
  botPlayerIds: string[];
  seatTokenHashes: Record<string, string>;
}

interface SocketAttachmentV1 {
  version: 1;
  viewerId: string;
}

interface GameSocketMessageV1 {
  version: 1;
  type: "game.snapshot";
  snapshot: StoredGameSnapshot;
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

async function hashSeatToken(token: string): Promise<string> {
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

export class GameRoom extends DurableObject<GameRoomEnv> {
  private async readState(): Promise<PersistedGameRoomV1 | null> {
    return (await this.ctx.storage.get<PersistedGameRoomV1>(STATE_KEY)) ?? null;
  }

  private async writeState(state: PersistedGameRoomV1): Promise<void> {
    await this.ctx.storage.put(STATE_KEY, state);
  }

  private snapshot(state: PersistedGameRoomV1, viewerId: string): StoredGameSnapshot {
    return getRegisteredGame(state.room.gameId).snapshot(state.room, viewerId);
  }

  private async resolveSeat(state: PersistedGameRoomV1, token: string): Promise<string | null> {
    if (token.length < 24 || token.length > 256) return null;
    const hash = await hashSeatToken(token);

    for (const [playerId, expectedHash] of Object.entries(state.seatTokenHashes)) {
      if (constantTimeEqual(hash, expectedHash)) return playerId;
    }
    return null;
  }

  private runBots(state: PersistedGameRoomV1): PersistedGameRoomV1 {
    let room = state.room;
    const game = getRegisteredGame(room.gameId);

    for (let step = 0; step < MAX_AUTOMATED_MOVES && room.status === "playing"; step += 1) {
      let botSnapshot: StoredGameSnapshot | null = null;
      for (const botId of state.botPlayerIds) {
        const candidate = game.snapshot(room, botId);
        if (candidate.currentPlayerId === botId) {
          botSnapshot = candidate;
          break;
        }
      }
      if (!botSnapshot) break;

      const move = botSnapshot.legalMoves.find((candidate) => candidate.id !== "pass") ?? botSnapshot.legalMoves[0];
      if (!move) break;

      room = game.applyMove(room, {
        version: 1,
        roomId: room.roomId,
        playerId: botSnapshot.viewerId,
        expectedRevision: room.revision,
        moveId: move.id,
      });
    }

    return room === state.room ? state : { ...state, room };
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

  private async broadcast(state: PersistedGameRoomV1): Promise<void> {
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

  async initialize(request: InitializeGameRoomRequest): Promise<GameRoomRpcResult<StoredGameSnapshot>> {
    try {
      if (await this.readState()) {
        return { ok: false, error: { code: "room_exists", message: "Game room is already initialized." } };
      }
      if (request.botPlayerIds.length > 2 || new Set(request.botPlayerIds).size !== request.botPlayerIds.length) {
        return { ok: false, error: { code: "invalid_bots", message: "botPlayerIds must be unique and contain at most two players." } };
      }

      const game = getRegisteredGame(request.gameId);
      const room = game.create(request.roomId, request.gameInput);
      game.snapshot(room, request.viewerId);
      for (const botId of request.botPlayerIds) game.snapshot(room, botId);

      const seatTokenHashes: Record<string, string> = {};
      for (const [playerId, token] of Object.entries(request.seatTokens ?? {})) {
        game.snapshot(room, playerId);
        if (request.botPlayerIds.includes(playerId)) throw new Error("Bot seats cannot receive MCP seat tokens.");
        seatTokenHashes[playerId] = await hashSeatToken(token);
      }

      let state: PersistedGameRoomV1 = {
        version: 1,
        room,
        botPlayerIds: [...request.botPlayerIds],
        seatTokenHashes,
      };
      state = this.runBots(state);
      await this.writeState(state);
      return { ok: true, value: this.snapshot(state, request.viewerId) };
    } catch (error) {
      return failure(error);
    }
  }

  async getSnapshot(viewerId: string): Promise<GameRoomRpcResult<StoredGameSnapshot>> {
    try {
      const state = await this.readState();
      if (!state) return { ok: false, error: { code: "room_not_found", message: "Game room is not initialized." } };
      return { ok: true, value: this.snapshot(state, viewerId) };
    } catch (error) {
      return failure(error);
    }
  }

  async getSnapshotBySeatToken(seatToken: string): Promise<GameRoomRpcResult<StoredGameSnapshot>> {
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

  async applyMove(command: GameMoveCommandV1, viewerId: string): Promise<GameRoomRpcResult<StoredGameSnapshot>> {
    try {
      const state = await this.readState();
      if (!state) return { ok: false, error: { code: "room_not_found", message: "Game room is not initialized." } };
      const game = getRegisteredGame(state.room.gameId);
      const moved = game.applyMove(state.room, command);
      const next = this.runBots({ ...state, room: moved });
      await this.writeState(next);
      await this.broadcast(next);
      return { ok: true, value: this.snapshot(next, viewerId) };
    } catch (error) {
      return failure(error);
    }
  }

  async applyMoveBySeatToken(
    seatToken: string,
    expectedRevision: number,
    moveId: string,
  ): Promise<GameRoomRpcResult<StoredGameSnapshot>> {
    try {
      const state = await this.readState();
      if (!state) return { ok: false, error: { code: "room_not_found", message: "Game room is not initialized." } };
      const playerId = await this.resolveSeat(state, seatToken);
      if (!playerId) return { ok: false, error: { code: "invalid_seat_token", message: "Seat token is invalid." } };

      const game = getRegisteredGame(state.room.gameId);
      const moved = game.applyMove(state.room, {
        version: 1,
        roomId: state.room.roomId,
        playerId,
        expectedRevision,
        moveId,
      });
      const next = this.runBots({ ...state, room: moved });
      await this.writeState(next);
      await this.broadcast(next);
      return { ok: true, value: this.snapshot(next, playerId) };
    } catch (error) {
      return failure(error);
    }
  }

  async pause(viewerId: string): Promise<GameRoomRpcResult<StoredGameSnapshot>> {
    try {
      const state = await this.readState();
      if (!state) return { ok: false, error: { code: "room_not_found", message: "Game room is not initialized." } };
      const game = getRegisteredGame(state.room.gameId);
      const next = { ...state, room: game.pause(state.room) };
      await this.writeState(next);
      await this.broadcast(next);
      return { ok: true, value: this.snapshot(next, viewerId) };
    } catch (error) {
      return failure(error);
    }
  }

  async resume(viewerId: string): Promise<GameRoomRpcResult<StoredGameSnapshot>> {
    try {
      const state = await this.readState();
      if (!state) return { ok: false, error: { code: "room_not_found", message: "Game room is not initialized." } };
      const game = getRegisteredGame(state.room.gameId);
      let next = { ...state, room: game.resume(state.room) };
      next = this.runBots(next);
      await this.writeState(next);
      await this.broadcast(next);
      return { ok: true, value: this.snapshot(next, viewerId) };
    } catch (error) {
      return failure(error);
    }
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const viewerId = url.searchParams.get("viewer");
    if (request.method !== "GET" || request.headers.get("upgrade")?.toLowerCase() !== "websocket" || !viewerId) {
      return new Response("Expected a WebSocket upgrade with viewer.", { status: 426 });
    }

    const state = await this.readState();
    if (!state) return new Response("Room not found.", { status: 404 });
    try {
      this.snapshot(state, viewerId);
    } catch {
      return new Response("Viewer not in room.", { status: 403 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment({ version: 1, viewerId } satisfies SocketAttachmentV1);
    this.ctx.acceptWebSocket(server);
    await this.sendSnapshot(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, _message: string | ArrayBuffer): Promise<void> {
    await this.sendSnapshot(ws);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): Promise<void> {
    ws.close(code, reason);
  }
}
