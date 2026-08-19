import { DurableObject } from "cloudflare:workers";

export type DeviceScopeV1 = "agent:write";

export interface DeviceRecordV1 {
  version: 1;
  deviceId: string;
  tokenHash: string;
  scopes: DeviceScopeV1[];
  createdAt: number;
}

export interface DeviceIssueInputV1 {
  version: 1;
  deviceId: string;
  tokenHash: string;
  scopes: DeviceScopeV1[];
  createdAt: number;
}

export type DeviceAuthorizationResultV1 =
  | { ok: true; deviceId: string; scopes: DeviceScopeV1[] }
  | { ok: false };

export type DeviceRevocationResultV1 =
  | { revoked: true; deviceId: string }
  | { revoked: false };

export interface DeviceRegistryEnv {}

const TOKEN_PREFIX = "device-token:";
const DEVICE_PREFIX = "device-id:";

function tokenKey(tokenHash: string): string {
  return `${TOKEN_PREFIX}${tokenHash}`;
}

function deviceKey(deviceId: string): string {
  return `${DEVICE_PREFIX}${deviceId}`;
}

function isTokenHash(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

function validDeviceId(value: string): boolean {
  return value.length > 0 && value.length <= 128;
}

function normalizeScopes(scopes: DeviceScopeV1[]): DeviceScopeV1[] {
  return scopes.includes("agent:write") ? ["agent:write"] : [];
}

export class DeviceRegistry extends DurableObject<DeviceRegistryEnv> {
  async issue(input: DeviceIssueInputV1): Promise<DeviceRecordV1> {
    if (input.version !== 1 || !validDeviceId(input.deviceId) || !isTokenHash(input.tokenHash)) {
      throw new Error("invalid_device_credential");
    }
    if (!Number.isSafeInteger(input.createdAt) || input.createdAt <= 0) {
      throw new Error("invalid_device_credential");
    }

    const scopes = normalizeScopes(input.scopes);
    if (scopes.length === 0) throw new Error("invalid_device_scope");

    const previousHash = await this.ctx.storage.get<string>(deviceKey(input.deviceId));
    if (previousHash && previousHash !== input.tokenHash) {
      await this.ctx.storage.delete(tokenKey(previousHash));
    }

    const record: DeviceRecordV1 = {
      version: 1,
      deviceId: input.deviceId,
      tokenHash: input.tokenHash,
      scopes,
      createdAt: input.createdAt,
    };

    await this.ctx.storage.put(tokenKey(input.tokenHash), record);
    await this.ctx.storage.put(deviceKey(input.deviceId), input.tokenHash);
    return record;
  }

  async authorize(tokenHash: string, scope: DeviceScopeV1): Promise<DeviceAuthorizationResultV1> {
    if (!isTokenHash(tokenHash)) return { ok: false };
    const record = await this.ctx.storage.get<DeviceRecordV1>(tokenKey(tokenHash));
    if (!record || !record.scopes.includes(scope)) return { ok: false };

    const currentHash = await this.ctx.storage.get<string>(deviceKey(record.deviceId));
    if (currentHash !== tokenHash) return { ok: false };

    return {
      ok: true,
      deviceId: record.deviceId,
      scopes: [...record.scopes],
    };
  }

  async revoke(tokenHash: string): Promise<DeviceRevocationResultV1> {
    if (!isTokenHash(tokenHash)) return { revoked: false };
    const record = await this.ctx.storage.get<DeviceRecordV1>(tokenKey(tokenHash));
    if (!record) return { revoked: false };

    await this.ctx.storage.delete(tokenKey(tokenHash));
    const currentHash = await this.ctx.storage.get<string>(deviceKey(record.deviceId));
    if (currentHash === tokenHash) {
      await this.ctx.storage.delete(deviceKey(record.deviceId));
    }
    return { revoked: true, deviceId: record.deviceId };
  }
}
