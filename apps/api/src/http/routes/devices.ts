import { ApiError, invalidPayload } from "../../errors.js";
import { isAuthEnabled } from "../auth.js";
import type { HttpContext } from "../context.js";
import { readJson } from "../request.js";
import { writeJson } from "../response.js";
import type { CollectionTask, RuntimeLogLevel } from "../../models.js";
import { optionalString, requireObject, requireString } from "../../validation.js";

export async function routeDevices(context: HttpContext): Promise<boolean> {
  const { request, response, url, service, reports, options, auth } = context;

  if (request.method === "POST" && url.pathname === "/api/v1/devices/register") {
    const body = requireObject(await readJson(request));
    const registrationCode = optionalString(body, "registration_code");
    if (!isAuthEnabled(options) && !registrationCode) {
      const device = await service.registerDevelopmentDevice({
        id: optionalString(body, "device_id") || undefined,
        name: requireString(body, "name"),
        extensionVersion: requireString(body, "extension_version")
      });
      writeJson(response, 200, { status: "success", data: { device: serializeDevice(device) } }, options.corsOrigin);
      return true;
    }
    const result = await service.registerDevice({
      code: registrationCode || requireString(body, "registration_code"),
      name: requireString(body, "name"),
      extensionVersion: requireString(body, "extension_version")
    });
    writeJson(response, 201, { status: "success", data: serializeRegistration(result) }, options.corsOrigin);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/devices/token:refresh") {
    const body = requireObject(await readJson(request));
    const tokens = await service.refreshDeviceToken(requireString(body, "refresh_token"));
    writeJson(response, 200, { status: "success", data: serializeTokens(tokens) }, options.corsOrigin);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/devices/heartbeat") {
    if (auth?.type !== "device") throw new Error("Device authentication context is missing");
    const device = auth.device;
    const body = requireObject(await readJson(request));
    const updated = await service.heartbeat(device.id, {
      extensionVersion: requireString(body, "extension_version"),
      queueDepth: Number(body.queue_depth ?? 0),
      taskId: optionalString(body, "task_id") || undefined
    });
    writeJson(response, 200, { status: "success", data: { ...serializeDevice(updated), task_cancelled: Boolean(updated.taskCancelled) } }, options.corsOrigin);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/devices/tasks:claim") {
    if (auth?.type !== "device") throw new Error("Device authentication context is missing");
    const device = auth.device;
    const task = await service.claimNextTask(device.id);
    writeJson(response, 200, { status: "success", data: { task: task ? serializeTask(task) : null } }, options.corsOrigin);
    return true;
  }

  const deviceTaskStatusMatch = url.pathname.match(/^\/api\/v1\/devices\/tasks\/([^/]+):status$/);
  if (request.method === "POST" && deviceTaskStatusMatch) {
    if (auth?.type !== "device") throw new Error("Device authentication context is missing");
    const device = auth.device;
    const body = requireObject(await readJson(request));
    const task = await service.updateTask(device.id, decodeURIComponent(deviceTaskStatusMatch[1]), {
      status: parseTaskStatus(requireString(body, "status")),
      runId: optionalString(body, "run_id") || undefined,
      errorCode: optionalString(body, "error_code") || undefined
    });
    if (task.status === "completed") {
      try {
        await reports.enqueueAutomatic(task.runId);
      } catch (error) {
        console.error("Automatic report enqueue failed", error instanceof ApiError ? error.code : "unknown_error");
      }
    }
    writeJson(response, 200, { status: "success", data: serializeTask(task) }, options.corsOrigin);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/devices/logs") {
    if (auth?.type !== "device") throw new Error("Device authentication context is missing");
    const device = auth.device;
    const body = requireObject(await readJson(request));
    const metadataValue = body.metadata === undefined ? undefined : requireObject(body.metadata, "metadata");
    const metadata = metadataValue ? Object.fromEntries(Object.entries(metadataValue).map(([key, value]) => [key, typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null ? value : String(value)])) : undefined;
    const log = await service.appendLog({
      deviceId: device.id,
      taskId: optionalString(body, "task_id") || undefined,
      level: parseLogLevel(requireString(body, "level")),
      event: requireString(body, "event"),
      message: requireString(body, "message"),
      metadata
    });
    writeJson(response, 201, { status: "success", data: serializeLog(log) }, options.corsOrigin);
    return true;
  }

  return false;
}

export function serializeRegistration(result: Awaited<ReturnType<import("../../service.js").CollectionService["registerDevice"]>>) {
  return { device: serializeDevice(result.device), ...serializeTokens(result.tokens) };
}

export function serializeTokens(tokens: { accessToken: string; accessTokenExpiresAt: string; refreshToken: string; refreshTokenExpiresAt: string }) {
  return {
    access_token: tokens.accessToken,
    access_token_expires_at: tokens.accessTokenExpiresAt,
    refresh_token: tokens.refreshToken,
    refresh_token_expires_at: tokens.refreshTokenExpiresAt
  };
}

export function serializeDevice(device: { id: string; name: string; extensionVersion: string; registeredAt: string; lastHeartbeatAt?: string; queueDepth: number; status: string; revokedAt?: string }) {
  return {
    id: device.id,
    name: device.name,
    extension_version: device.extensionVersion,
    registered_at: device.registeredAt,
    last_heartbeat_at: device.lastHeartbeatAt,
    queue_depth: device.queueDepth,
    status: device.status,
    revoked_at: device.revokedAt
  };
}

export function serializeTask(task: CollectionTask) {
  return {
    id: task.id,
    device_id: task.deviceId,
    type: task.type,
    status: task.status,
    business_date: task.businessDate,
    idempotency_key: task.idempotencyKey,
    run_id: task.runId,
    created_at: task.createdAt,
    claimed_at: task.claimedAt,
    last_heartbeat_at: task.lastHeartbeatAt,
    completed_at: task.completedAt,
    error_code: task.errorCode,
    schedule_id: task.scheduleId
  };
}

export function serializeLog(log: { id: string; deviceId: string; taskId?: string; level: string; event: string; message: string; metadata?: Record<string, unknown>; occurredAt: string }) {
  return {
    id: log.id,
    device_id: log.deviceId,
    task_id: log.taskId,
    level: log.level,
    event: log.event,
    message: log.message,
    metadata: log.metadata,
    occurred_at: log.occurredAt
  };
}

function parseTaskStatus(value: string): CollectionTask["status"] {
  const values: CollectionTask["status"][] = ["pending", "running", "paused", "completed", "failed", "cancelled"];
  if (!values.includes(value as CollectionTask["status"])) throw invalidPayload("status is invalid");
  return value as CollectionTask["status"];
}

function parseLogLevel(value: string): RuntimeLogLevel {
  const values: RuntimeLogLevel[] = ["info", "warn", "error"];
  if (!values.includes(value as RuntimeLogLevel)) throw invalidPayload("level is invalid");
  return value as RuntimeLogLevel;
}
