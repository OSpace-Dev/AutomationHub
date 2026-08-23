import type { IncomingMessage } from "node:http";
import { ApiError } from "../shared/errors.js";
import type { CollectionService } from "../application/collection-service.js";
import type { Device } from "../domain/models.js";

export interface AuthOptions {
  adminApiKey?: string;
  authEnabled?: boolean;
}

export type AuthContext = DeviceAuthContext | AdminAuthContext;

export interface DeviceAuthContext {
  type: "device";
  device: Device;
}

export interface AdminAuthContext {
  type: "admin";
}

export function isAuthEnabled(options: AuthOptions): boolean {
  return options.authEnabled === true;
}

export async function authenticateDevice(request: IncomingMessage, service: CollectionService, options: AuthOptions): Promise<DeviceAuthContext> {
  if (!isAuthEnabled(options)) {
    const deviceId = request.headers["x-device-id"];
    if (typeof deviceId !== "string" || !deviceId) throw new ApiError(401, "device_not_registered", "Development device is not registered");
    return { type: "device", device: await service.authenticateDevelopmentDevice(deviceId) };
  }
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) throw new ApiError(401, "invalid_token", "Bearer token is required");
  return { type: "device", device: await service.authenticate(authorization.slice(7)) };
}

export function requireAdmin(request: IncomingMessage, options: AuthOptions): AdminAuthContext {
  if (!isAuthEnabled(options)) return { type: "admin" };
  if (!options.adminApiKey) throw new ApiError(503, "admin_not_configured", "Admin API key is not configured");
  if (request.headers["x-admin-key"] !== options.adminApiKey) throw new ApiError(403, "admin_forbidden", "Admin access is forbidden");
  return { type: "admin" };
}
