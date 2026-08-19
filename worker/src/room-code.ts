import { sha256Hex } from "./http";

const JOIN_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const JOIN_RANDOM_LENGTH = 10;
const JOIN_CODE_PATTERN = /^WL-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$/;

export function normalizeJoinCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!JOIN_CODE_PATTERN.test(normalized)) {
    throw new Error("Join code must look like WL-XXXXXXXXXX.");
  }
  return normalized;
}

export function createJoinCode(randomBytes?: Uint8Array): string {
  const bytes = randomBytes ?? crypto.getRandomValues(new Uint8Array(JOIN_RANDOM_LENGTH));
  if (bytes.length < JOIN_RANDOM_LENGTH) throw new Error("Not enough randomness for join code.");

  let suffix = "";
  for (let index = 0; index < JOIN_RANDOM_LENGTH; index += 1) {
    suffix += JOIN_ALPHABET[bytes[index]! % JOIN_ALPHABET.length];
  }
  return `WL-${suffix}`;
}

export async function joinCodeHash(code: string): Promise<string> {
  return sha256Hex(`waitloop-join-v1:${normalizeJoinCode(code)}`);
}

export async function roomIdForJoinCode(code: string): Promise<string> {
  const hash = await joinCodeHash(code);
  return `room-${hash.slice(0, 32)}`;
}

export function selectRandomPlayer<T extends string>(players: readonly T[], randomValue?: number): T {
  if (players.length === 0) throw new Error("Cannot choose from an empty player list.");
  const value = randomValue ?? crypto.getRandomValues(new Uint32Array(1))[0]!;
  const player = players[value % players.length];
  if (player === undefined) throw new Error("Random player selection failed.");
  return player;
}
