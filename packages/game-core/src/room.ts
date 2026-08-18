import {
  GameRoomError,
  type GameDefinition,
  type GameMoveCommandV1,
  type GameRoomSnapshotV1,
  type GameRoomStateV1,
} from "./types";

function assertDefinitionMatches<TState>(
  definition: GameDefinition<TState, unknown, unknown, unknown>,
  room: GameRoomStateV1<TState>,
): void {
  if (definition.id !== room.gameId) {
    throw new GameRoomError(
      "definition_mismatch",
      `Room uses game ${room.gameId}, not ${definition.id}.`,
    );
  }
}

export function createGameRoom<TState, TPublicState, TCreateInput, TMoveMeta>(
  definition: GameDefinition<TState, TPublicState, TCreateInput, TMoveMeta>,
  roomId: string,
  input: TCreateInput,
): GameRoomStateV1<TState> {
  const gameState = definition.create(input);

  return {
    version: 1,
    roomId,
    gameId: definition.id,
    status: definition.getStatus(gameState),
    revision: 1,
    gameState,
  };
}

export function getGameRoomSnapshot<TState, TPublicState, TCreateInput, TMoveMeta>(
  definition: GameDefinition<TState, TPublicState, TCreateInput, TMoveMeta>,
  room: GameRoomStateV1<TState>,
  viewerId: string,
): GameRoomSnapshotV1<TPublicState, TMoveMeta> {
  assertDefinitionMatches(
    definition as GameDefinition<TState, unknown, unknown, unknown>,
    room,
  );

  const players = definition.getPlayerIds(room.gameState);
  if (!players.includes(viewerId)) {
    throw new GameRoomError("viewer_not_in_room", "Viewer is not a player in this room.");
  }

  const currentPlayerId = definition.getCurrentPlayerId(room.gameState);
  const canMove = room.status === "playing" && currentPlayerId === viewerId;

  return {
    version: 1,
    roomId: room.roomId,
    gameId: room.gameId,
    status: room.status,
    revision: room.revision,
    viewerId,
    currentPlayerId,
    state: definition.getPublicState(room.gameState, viewerId),
    legalMoves: canMove ? definition.getLegalMoves(room.gameState, viewerId) : [],
  };
}

export function applyGameRoomMove<TState, TPublicState, TCreateInput, TMoveMeta>(
  definition: GameDefinition<TState, TPublicState, TCreateInput, TMoveMeta>,
  room: GameRoomStateV1<TState>,
  command: GameMoveCommandV1,
): GameRoomStateV1<TState> {
  assertDefinitionMatches(
    definition as GameDefinition<TState, unknown, unknown, unknown>,
    room,
  );

  if (command.roomId !== room.roomId) {
    throw new GameRoomError("room_mismatch", "Move command targets a different room.");
  }

  if (command.expectedRevision !== room.revision) {
    throw new GameRoomError(
      "stale_revision",
      `Expected room revision ${command.expectedRevision}, current revision is ${room.revision}.`,
    );
  }

  if (room.status === "finished") {
    throw new GameRoomError("room_finished", "The game has already finished.");
  }

  if (room.status === "paused") {
    throw new GameRoomError("room_paused", "The game is currently paused.");
  }

  const players = definition.getPlayerIds(room.gameState);
  if (!players.includes(command.playerId)) {
    throw new GameRoomError("player_not_in_room", "Player is not a member of this room.");
  }

  const currentPlayerId = definition.getCurrentPlayerId(room.gameState);
  if (currentPlayerId !== command.playerId) {
    throw new GameRoomError("not_players_turn", "It is not this player's turn.");
  }

  const legalMoves = definition.getLegalMoves(room.gameState, command.playerId);
  if (!legalMoves.some((move) => move.id === command.moveId)) {
    throw new GameRoomError("illegal_move", "Move ID is not legal for the current room revision.");
  }

  const gameState = definition.applyMove(room.gameState, command.playerId, command.moveId);

  return {
    ...room,
    status: definition.getStatus(gameState),
    revision: room.revision + 1,
    gameState,
  };
}

export function pauseGameRoom<TState>(room: GameRoomStateV1<TState>): GameRoomStateV1<TState> {
  if (room.status === "finished" || room.status === "paused") {
    return room;
  }

  return {
    ...room,
    status: "paused",
    revision: room.revision + 1,
  };
}

export function resumeGameRoom<TState, TPublicState, TCreateInput, TMoveMeta>(
  definition: GameDefinition<TState, TPublicState, TCreateInput, TMoveMeta>,
  room: GameRoomStateV1<TState>,
): GameRoomStateV1<TState> {
  assertDefinitionMatches(
    definition as GameDefinition<TState, unknown, unknown, unknown>,
    room,
  );

  if (room.status !== "paused") {
    return room;
  }

  return {
    ...room,
    status: definition.getStatus(room.gameState),
    revision: room.revision + 1,
  };
}
