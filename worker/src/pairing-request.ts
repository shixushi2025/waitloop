import { DurableObject } from "cloudflare:workers";

export interface PairingRequestStateV1 {
  version: 1;
  pairingId: string;
  deviceId: string;
  verifierHash: string;
  createdAt: number;
  expiresAt: number;
  approvedAt?: number;
  exchangedAt?: number;
}

export type PairingRequestPublicV1 = Omit<PairingRequestStateV1, "verifierHash">;

export type PairingApprovalResultV1 =
  | { ok: true; snapshot: PairingRequestPublicV1 }
  | { ok: false; code: "pairing_not_found" | "pairing_expired" };

export type PairingExchangeResultV1 =
  | { ok: true; deviceId: string; expiresAt: number }
  | {
      ok: false;
      code:
        | "pairing_not_found"
        | "pairing_expired"
        | "pairing_pending"
        | "pairing_consumed"
        | "invalid_verifier";
    };

export interface PairingRequestEnv {}

const STATE_KEY = "pairing";

function validPairingId(value: string): boolean {
  return /^pair_[A-Za-z0-9_-]{32,128}$/.test(value);
}

function validDeviceId(value: string): boolean {
  return /^[A-Za-z0-9._:-]{1,128}$/.test(value);
}

function validHash(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

function constantTimeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function publicSnapshot(state: PairingRequestStateV1): PairingRequestPublicV1 {
  const result: PairingRequestPublicV1 = {
    version: 1,
    pairingId: state.pairingId,
    deviceId: state.deviceId,
    createdAt: state.createdAt,
    expiresAt: state.expiresAt,
  };
  if (state.approvedAt !== undefined) result.approvedAt = state.approvedAt;
  if (state.exchangedAt !== undefined) result.exchangedAt = state.exchangedAt;
  return result;
}

export class PairingRequest extends DurableObject<PairingRequestEnv> {
  async initialize(input: PairingRequestStateV1): Promise<PairingRequestPublicV1> {
    if (
      input.version !== 1 ||
      !validPairingId(input.pairingId) ||
      !validDeviceId(input.deviceId) ||
      !validHash(input.verifierHash) ||
      !Number.isSafeInteger(input.createdAt) ||
      !Number.isSafeInteger(input.expiresAt) ||
      input.expiresAt <= input.createdAt
    ) {
      throw new Error("invalid_pairing_request");
    }

    const existing = await this.ctx.storage.get<PairingRequestStateV1>(STATE_KEY);
    if (existing) return publicSnapshot(existing);

    await this.ctx.storage.put(STATE_KEY, input);
    await this.ctx.storage.setAlarm(input.expiresAt + 60_000);
    return publicSnapshot(input);
  }

  async getSnapshot(): Promise<PairingRequestPublicV1 | null> {
    const state = await this.ctx.storage.get<PairingRequestStateV1>(STATE_KEY);
    return state ? publicSnapshot(state) : null;
  }

  async approve(now: number): Promise<PairingApprovalResultV1> {
    const state = await this.ctx.storage.get<PairingRequestStateV1>(STATE_KEY);
    if (!state) return { ok: false, code: "pairing_not_found" };
    if (now > state.expiresAt) return { ok: false, code: "pairing_expired" };

    if (state.approvedAt === undefined) {
      const next: PairingRequestStateV1 = { ...state, approvedAt: now };
      await this.ctx.storage.put(STATE_KEY, next);
      return { ok: true, snapshot: publicSnapshot(next) };
    }

    return { ok: true, snapshot: publicSnapshot(state) };
  }

  async exchange(verifierHash: string, now: number): Promise<PairingExchangeResultV1> {
    const state = await this.ctx.storage.get<PairingRequestStateV1>(STATE_KEY);
    if (!state) return { ok: false, code: "pairing_not_found" };
    if (now > state.expiresAt) return { ok: false, code: "pairing_expired" };
    if (state.exchangedAt !== undefined) return { ok: false, code: "pairing_consumed" };
    if (!validHash(verifierHash) || !constantTimeEqual(verifierHash, state.verifierHash)) {
      return { ok: false, code: "invalid_verifier" };
    }
    if (state.approvedAt === undefined) return { ok: false, code: "pairing_pending" };

    const next: PairingRequestStateV1 = { ...state, exchangedAt: now };
    await this.ctx.storage.put(STATE_KEY, next);
    return { ok: true, deviceId: state.deviceId, expiresAt: state.expiresAt };
  }

  override async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
