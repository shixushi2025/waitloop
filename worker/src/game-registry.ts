import {
  applyGameRoomMove,
  createGameRoom,
  getGameRoomSnapshot,
  pauseGameRoom,
  resumeGameRoom,
  type GameMoveCommandV1,
  type GameRoomSnapshotV1,
  type GameRoomStateV1,
} from "@waitloop/game-core";
import {
  doudizhuGame,
  type DoudizhuCreateInput,
  type DoudizhuGameMoveMeta,
  type DoudizhuPublicStateV1,
  type DoudizhuStateV1,
} from "@waitloop/doudizhu";

export type StoredGameRoom = GameRoomStateV1<unknown>;
export type StoredGameSnapshot = GameRoomSnapshotV1<unknown, unknown>;

interface RegisteredGame {
  id: string;
  create(roomId: string, input: unknown): StoredGameRoom;
  snapshot(room: StoredGameRoom, viewerId: string): StoredGameSnapshot;
  applyMove(room: StoredGameRoom, command: GameMoveCommandV1): StoredGameRoom;
  pause(room: StoredGameRoom): StoredGameRoom;
  resume(room: StoredGameRoom): StoredGameRoom;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDoudizhuCreateInput(input: unknown): DoudizhuCreateInput {
  if (!isRecord(input)) throw new Error("Dou Dizhu create input must be an object.");

  const playerIds = input.playerIds;
  const landlordId = input.landlordId;

  if (
    !Array.isArray(playerIds) ||
    playerIds.length !== 3 ||
    !playerIds.every((value) => typeof value === "string" && value.length > 0 && value.length <= 64)
  ) {
    throw new Error("playerIds must contain exactly three non-empty strings.");
  }

  if (new Set(playerIds).size !== 3) {
    throw new Error("playerIds must be distinct.");
  }

  if (typeof landlordId !== "string" || !playerIds.includes(landlordId)) {
    throw new Error("landlordId must identify one of the three players.");
  }

  return {
    playerIds: [playerIds[0]!, playerIds[1]!, playerIds[2]!],
    landlordId,
  };
}

const doudizhuRegistration: RegisteredGame = {
  id: "doudizhu",

  create(roomId, input) {
    return createGameRoom(doudizhuGame, roomId, parseDoudizhuCreateInput(input)) as StoredGameRoom;
  },

  snapshot(room, viewerId) {
    return getGameRoomSnapshot(
      doudizhuGame,
      room as GameRoomStateV1<DoudizhuStateV1>,
      viewerId,
    ) as GameRoomSnapshotV1<DoudizhuPublicStateV1, DoudizhuGameMoveMeta> as StoredGameSnapshot;
  },

  applyMove(room, command) {
    return applyGameRoomMove(
      doudizhuGame,
      room as GameRoomStateV1<DoudizhuStateV1>,
      command,
    ) as StoredGameRoom;
  },

  pause(room) {
    return pauseGameRoom(room);
  },

  resume(room) {
    return resumeGameRoom(
      doudizhuGame,
      room as GameRoomStateV1<DoudizhuStateV1>,
    ) as StoredGameRoom;
  },
};

const REGISTRY: ReadonlyMap<string, RegisteredGame> = new Map([
  [doudizhuRegistration.id, doudizhuRegistration],
]);

export function getRegisteredGame(gameId: string): RegisteredGame {
  const game = REGISTRY.get(gameId);
  if (!game) throw new Error(`Unknown game: ${gameId}.`);
  return game;
}
