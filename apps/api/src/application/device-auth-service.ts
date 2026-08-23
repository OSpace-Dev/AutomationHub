import { createId, createOpaqueToken, createRegistrationCode, hashSecret } from "../shared/crypto.js";
import { ApiError } from "../shared/errors.js";
import type { Device, DeviceToken, RegistrationCode, StoreData } from "../domain/models.js";
import type { Store } from "./ports/store.js";

const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const AUTHORIZATION_TTLS = { "24h": 24 * 60 * 60 * 1000, "7d": 7 * 24 * 60 * 60 * 1000, "30d": 30 * 24 * 60 * 60 * 1000 } as const;

export type AuthorizationExpiry = keyof typeof AUTHORIZATION_TTLS | "never";

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface TokenPair {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export function requireActiveDevice(data: StoreData, deviceId: string): Device {
  const device = data.devices.find((entry) => entry.id === deviceId);
  if (!device || device.status !== "active") throw new ApiError(403, "device_revoked", "Device is revoked");
  return device;
}

export class DeviceAuthService {
  constructor(private readonly store: Store) {}

  async createRegistrationCode(expiresIn: AuthorizationExpiry): Promise<{ authorization: RegistrationCode; code: string }> {
    return this.store.update((data) => {
      const now = new Date();
      const code = createRegistrationCode();
      const authorization: RegistrationCode = {
        id: createId(),
        codeHash: hashSecret(code),
        codeHint: code.slice(-6),
        createdAt: now.toISOString(),
        expiresAt: expiresIn === "never" ? undefined : new Date(now.getTime() + AUTHORIZATION_TTLS[expiresIn]).toISOString()
      };
      data.registrationCodes.push(authorization);
      return { authorization: structuredClone(authorization), code };
    });
  }

  async listRegistrationCodes(page = 1, pageSize = DEFAULT_PAGE_SIZE): Promise<PageResult<RegistrationCode>> {
    const data = await this.store.read();
    return paginate(data.registrationCodes.filter((entry) => !entry.revokedAt).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")), page, pageSize);
  }

  async revokeRegistrationCode(authorizationId: string): Promise<RegistrationCode> {
    return this.store.update((data) => {
      const authorization = data.registrationCodes.find((entry) => entry.id === authorizationId && !entry.revokedAt);
      if (!authorization) throw new ApiError(404, "authorization_not_found", "Authorization was not found");
      const now = new Date().toISOString();
      authorization.revokedAt = now;
      if (authorization.deviceId) this.revokeDeviceInData(data, authorization.deviceId, now);
      return structuredClone(authorization);
    });
  }

  async registerDevelopmentDevice(input: { id?: string; name: string; extensionVersion: string }): Promise<Device> {
    return this.store.update((data) => {
      const existing = input.id ? data.devices.find((entry) => entry.id === input.id && entry.status === "active") : undefined;
      if (existing) {
        existing.name = input.name;
        existing.extensionVersion = input.extensionVersion;
        return structuredClone(existing);
      }
      const now = new Date().toISOString();
      const device: Device = {
        id: input.id || createId(),
        name: input.name,
        extensionVersion: input.extensionVersion,
        registeredAt: now,
        queueDepth: 0,
        status: "active"
      };
      data.devices.push(device);
      return structuredClone(device);
    });
  }

  async authenticateDevelopmentDevice(deviceId: string): Promise<Device> {
    const data = await this.store.read();
    return this.requireActiveDevice(data, deviceId);
  }

  async registerDevice(input: { code: string; name: string; extensionVersion: string }): Promise<{ device: Device; tokens: TokenPair }> {
    return this.store.update((data) => {
      const now = new Date();
      const registration = data.registrationCodes.find((entry) => entry.codeHash === hashSecret(input.code));
      if (!registration || registration.revokedAt || registration.usedAt || (registration.expiresAt && new Date(registration.expiresAt) <= now)) {
        throw new ApiError(401, "invalid_registration_code", "Registration code is invalid, expired, or already used");
      }

      registration.usedAt = now.toISOString();
      const device: Device = {
        id: createId(),
        name: input.name,
        extensionVersion: input.extensionVersion,
        registeredAt: now.toISOString(),
        queueDepth: 0,
        status: "active",
        registrationCodeId: registration.id
      };
      data.devices.push(device);
      registration.deviceId = device.id;
      return { device, tokens: this.issueTokens(data, device.id, now) };
    });
  }

  async refreshDeviceToken(refreshToken: string): Promise<TokenPair> {
    return this.store.update((data) => {
      const now = new Date();
      const token = this.findValidToken(data, refreshToken, "refresh", now);
      token.revokedAt = now.toISOString();
      return this.issueTokens(data, token.deviceId, now);
    });
  }

  async authenticate(accessToken: string): Promise<Device> {
    const data = await this.store.read();
    const token = this.findValidToken(data, accessToken, "access", new Date());
    const device = data.devices.find((entry) => entry.id === token.deviceId);
    if (!device || device.status !== "active") throw new ApiError(403, "device_revoked", "Device is revoked");
    return device;
  }

  async revokeDevice(deviceId: string): Promise<Device> {
    return this.store.update((data) => {
      const device = data.devices.find((entry) => entry.id === deviceId);
      if (!device) throw new ApiError(404, "device_not_found", "Device was not found");
      const now = new Date().toISOString();
      this.revokeDeviceInData(data, deviceId, now);
      return structuredClone(device);
    });
  }

  requireActiveDevice(data: StoreData, deviceId: string): Device {
    return requireActiveDevice(data, deviceId);
  }

  private revokeDeviceInData(data: StoreData, deviceId: string, revokedAt: string): void {
    const device = data.devices.find((entry) => entry.id === deviceId);
    if (!device) throw new ApiError(404, "device_not_found", "Device was not found");
    device.status = "revoked";
    device.revokedAt = revokedAt;
    for (const token of data.tokens) {
      if (token.deviceId === deviceId && !token.revokedAt) token.revokedAt = revokedAt;
    }
    for (const schedule of data.schedules) {
      if (schedule.deviceId === deviceId && schedule.status === "active") {
        schedule.status = "cancelled";
        schedule.cancelledAt = revokedAt;
        schedule.nextRunAt = undefined;
      }
    }
  }

  private issueTokens(data: StoreData, deviceId: string, now: Date): TokenPair {
    const accessToken = createOpaqueToken();
    const refreshToken = createOpaqueToken();
    const accessTokenExpiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_MS).toISOString();
    const refreshTokenExpiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS).toISOString();
    data.tokens.push(
      { id: createId(), deviceId, tokenHash: hashSecret(accessToken), kind: "access", expiresAt: accessTokenExpiresAt },
      { id: createId(), deviceId, tokenHash: hashSecret(refreshToken), kind: "refresh", expiresAt: refreshTokenExpiresAt }
    );
    return { accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt };
  }

  private findValidToken(data: StoreData, secret: string, kind: DeviceToken["kind"], now: Date): DeviceToken {
    const token = data.tokens.find((entry) => entry.kind === kind && entry.tokenHash === hashSecret(secret));
    if (!token) throw new ApiError(401, "invalid_token", `${kind} token is invalid or expired`);
    const device = data.devices.find((entry) => entry.id === token.deviceId);
    if (!device || device.status !== "active") throw new ApiError(403, "device_revoked", "Device is revoked");
    if (token.revokedAt || new Date(token.expiresAt) <= now) throw new ApiError(401, "invalid_token", `${kind} token is invalid or expired`);
    return token;
  }
}

function paginate<T>(values: T[], requestedPage = 1, requestedPageSize = DEFAULT_PAGE_SIZE): PageResult<T> {
  const pageSize = Math.min(Math.max(Number.isFinite(requestedPageSize) ? Math.trunc(requestedPageSize) : DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const total = values.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1, 1), totalPages);
  return { items: values.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize, totalPages };
}
