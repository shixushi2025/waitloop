export type GameEngineStatus = "waiting" | "playing" | "finished";
export type GameRoomStatus = GameEngineStatus | "paused";

export interface LegalMove<TMeta = unknown> {
  id: string;
  label: string;
  meta?: TMeta;
}

export interface GameDefinition<TState, TPublicState, TCreateInput, TMoveMeta = unknown> {
  readonly id: string;

  create(input: TCreateInput): TState;
  getStatus(state: TState): GameEngineStatus;
  getPlayerIds(state: TState): readonly string[];
  getCurrentPlayerId(state: TState): string | null;
  getPublicState(state: TState, viewerId: string): TPublicState;
  getLegalMoves(state: TState, playerId: string): readonly LegalMove<TMoveMeta>[];
  applyMove(state: TState, playerId: string, moveId: string): TState;
}

export interface GameRoomStateV1<TGameState> {
  version: 1;
  roomId: string;
  gameId: string;
  status: GameRoomStatus;
  revision: number;
  gameState: TGameState;
}

export interface GameRoomSnapshotV1<TPublicState, TMoveMeta = unknown> {
  version: 1;
  roomId: string;
  gameId: string;
  status: GameRoomStatus;
  revision: number;
  viewerId: string;
  currentPlayerId: string | null;
  state: TPublicState;
  legalMoves: readonly LegalMove<TMoveMeta>[];
}

export interface GameMoveCommandV1 {
  version: 1;
  roomId: string;
  playerId: string;
  expectedRevision: number;
  moveId: string;
}

export type GameRoomErrorCode =
  | "definition_mismatch"
  | "viewer_not_in_room"
  | "player_not_in_room"
  | "room_finished"
  | "room_paused"
  | "not_players_turn"
  | "illegal_move"
  | "stale_revision"
  | "room_mismatch";

export class GameRoomError extends Error {
  readonly code: GameRoomErrorCode;

  constructor(code: GameRoomErrorCode, message: string) {
    super(message);
    this.name = "GameRoomError";
    this.code = code;
  }
}
