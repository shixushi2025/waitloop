export const ROOM_REFRESH_MIN_DELAY_MS: number;
export const ROOM_REFRESH_MAX_DELAY_MS: number;

export function shouldRefreshRoom(current: unknown, visible?: boolean): boolean;
export function nextRoomRefreshDelay(currentDelay: number, changed: boolean): number;
export function roomRefreshSignature(current: unknown): string;
