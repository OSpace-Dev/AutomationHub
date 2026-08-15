import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { ApiError, invalidPayload } from "./errors.js";
import type { CollectionTask, ProjectSnapshot, RegistrationCode, RuntimeLogLevel, ScheduleRecurrence, TaskSchedule, TaskStatus, TaskType } from "./models.js";
import { CollectionService, type AuthorizationExpiry } from "./service.js";
import type { Store } from "./store.js";
import { optionalString, requireInteger, requireObject, requireString } from "./validation.js";

interface ServerOptions {
  store: Store;
  adminApiKey?: string;
  corsOrigin: string;
  authEnabled?: boolean;
  adminDistPath?: string;
}

export function createApiServer(options: ServerOptions): Server {
  const service = new CollectionService(options.store);
  return createServer(async (request, response) => {
    try {
      await routeRequest(request, response, service, options);
    } catch (error) {
      handleError(response, error, options.corsOrigin);
    }
  });
}

async function routeRequest(request: IncomingMessage, response: ServerResponse, service: CollectionService, options: ServerOptions): Promise<void> {
  if (request.method === "OPTIONS") return writeJson(response, 204, {}, options.corsOrigin);
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "GET" && url.pathname === "/health") {
    return writeJson(response, 200, { status: "ok", service: "automation-hub-api" }, options.corsOrigin);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/devices/register") {
    const body = requireObject(await readJson(request));
    const registrationCode = optionalString(body, "registration_code");
    if (!isAuthEnabled(options) && !registrationCode) {
      const device = await service.registerDevelopmentDevice({
        id: optionalString(body, "device_id") || undefined,
        name: requireString(body, "name"),
        extensionVersion: requireString(body, "extension_version")
      });
      return writeJson(response, 200, { status: "success", data: { device: serializeDevice(device) } }, options.corsOrigin);
    }
    const result = await service.registerDevice({
      code: registrationCode || requireString(body, "registration_code"),
      name: requireString(body, "name"),
      extensionVersion: requireString(body, "extension_version")
    });
    return writeJson(response, 201, { status: "success", data: serializeRegistration(result) }, options.corsOrigin);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/devices/token:refresh") {
    const body = requireObject(await readJson(request));
    const tokens = await service.refreshDeviceToken(requireString(body, "refresh_token"));
    return writeJson(response, 200, { status: "success", data: serializeTokens(tokens) }, options.corsOrigin);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/devices/heartbeat") {
    const device = await authenticateDevice(request, service, options);
    const body = requireObject(await readJson(request));
    const updated = await service.heartbeat(device.id, {
      extensionVersion: requireString(body, "extension_version"),
      queueDepth: Number(body.queue_depth ?? 0),
      taskId: optionalString(body, "task_id") || undefined
    });
    return writeJson(response, 200, { status: "success", data: { ...serializeDevice(updated), task_cancelled: Boolean(updated.taskCancelled) } }, options.corsOrigin);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/devices/tasks:claim") {
    const device = await authenticateDevice(request, service, options);
    const task = await service.claimNextTask(device.id);
    return writeJson(response, 200, { status: "success", data: { task: task ? serializeTask(task) : null } }, options.corsOrigin);
  }

  const deviceTaskStatusMatch = url.pathname.match(/^\/api\/v1\/devices\/tasks\/([^/]+):status$/);
  if (request.method === "POST" && deviceTaskStatusMatch) {
    const device = await authenticateDevice(request, service, options);
    const body = requireObject(await readJson(request));
    const task = await service.updateTask(device.id, decodeURIComponent(deviceTaskStatusMatch[1]), {
      status: parseTaskStatus(requireString(body, "status")),
      runId: optionalString(body, "run_id") || undefined,
      errorCode: optionalString(body, "error_code") || undefined
    });
    return writeJson(response, 200, { status: "success", data: serializeTask(task) }, options.corsOrigin);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/devices/logs") {
    const device = await authenticateDevice(request, service, options);
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
    return writeJson(response, 201, { status: "success", data: serializeLog(log) }, options.corsOrigin);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/collection-runs") {
    const device = await authenticateDevice(request, service, options);
    const body = requireObject(await readJson(request));
    const filtersValue = body.filters === undefined ? {} : requireObject(body.filters, "filters");
    const filters = Object.fromEntries(Object.entries(filtersValue).map(([key, value]) => [key, String(value)]));
    const result = await service.createRun(device.id, {
      businessDate: requireString(body, "business_date"),
      sourceUrl: requireString(body, "source_url"),
      filters,
      idempotencyKey: requireHeader(request, "idempotency-key")
    });
    return writeJson(response, result.created ? 201 : 200, { status: "success", data: result.run, meta: { created: result.created } }, options.corsOrigin);
  }

  const batchMatch = url.pathname.match(/^\/api\/v1\/collection-runs\/([^/]+)\/items:batch$/);
  if (request.method === "POST" && batchMatch) {
    const device = await authenticateDevice(request, service, options);
    const body = requireObject(await readJson(request));
    if (!Array.isArray(body.items)) throw invalidPayload("items must be an array");
    const items = body.items.map(parseSnapshotInput);
    const result = await service.uploadItems(device.id, decodeURIComponent(batchMatch[1]), items);
    return writeJson(response, 200, { status: "success", data: { ...result, rejected: 0 } }, options.corsOrigin);
  }

  if (url.pathname.startsWith("/api/v1/admin/")) requireAdmin(request, options);
  if (request.method === "GET" && url.pathname === "/api/v1/admin/runs") {
    const runs = await service.listRuns(url.searchParams.get("date") ?? undefined, readPage(url), readPageSize(url));
    return writeJson(response, 200, { status: "success", data: runs.items, meta: pageMeta(runs) }, options.corsOrigin);
  }

  const itemsMatch = url.pathname.match(/^\/api\/v1\/admin\/runs\/([^/]+)\/items$/);
  if (request.method === "GET" && itemsMatch) {
    const items = await service.listItems(decodeURIComponent(itemsMatch[1]), readPage(url), readPageSize(url));
    return writeJson(response, 200, { status: "success", data: items.items, meta: pageMeta(items) }, options.corsOrigin);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/admin/devices") {
    const devices = await service.listDevices(readPage(url), readPageSize(url));
    return writeJson(response, 200, { status: "success", data: devices.items.map(serializeDevice), meta: pageMeta(devices) }, options.corsOrigin);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/admin/authorizations") {
    const body = requireObject(await readJson(request));
    const result = await service.createRegistrationCode(parseAuthorizationExpiry(requireString(body, "expires_in")));
    return writeJson(response, 201, { status: "success", data: { authorization: serializeAuthorization(result.authorization), code: result.code } }, options.corsOrigin);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/admin/authorizations") {
    const authorizations = await service.listRegistrationCodes(readPage(url), readPageSize(url));
    return writeJson(response, 200, { status: "success", data: authorizations.items.map(serializeAuthorization), meta: pageMeta(authorizations) }, options.corsOrigin);
  }

  const deleteAuthorizationMatch = url.pathname.match(/^\/api\/v1\/admin\/authorizations\/([^/]+)$/);
  if (request.method === "DELETE" && deleteAuthorizationMatch) {
    const authorization = await service.revokeRegistrationCode(decodeURIComponent(deleteAuthorizationMatch[1]));
    return writeJson(response, 200, { status: "success", data: serializeAuthorization(authorization) }, options.corsOrigin);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/admin/tasks") {
    const body = requireObject(await readJson(request));
    const result = await service.createTask({
      deviceId: requireString(body, "device_id"),
      type: parseTaskType(requireString(body, "type")),
      businessDate: requireString(body, "business_date"),
      idempotencyKey: requireHeader(request, "idempotency-key")
    });
    return writeJson(response, result.created ? 201 : 200, { status: "success", data: serializeTask(result.task), meta: { created: result.created } }, options.corsOrigin);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/admin/tasks") {
    const tasks = await service.listTasks({
      date: url.searchParams.get("date") ?? undefined,
      deviceId: url.searchParams.get("device_id") ?? undefined,
      status: url.searchParams.get("status") ? parseTaskStatus(url.searchParams.get("status") as string) : undefined,
      page: readPage(url),
      pageSize: url.searchParams.has("page_size") ? readPageSize(url) : undefined
    });
    return writeJson(response, 200, { status: "success", data: tasks.items.map(serializeTask), meta: pageMeta(tasks) }, options.corsOrigin);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/admin/schedules") {
    const body = requireObject(await readJson(request));
    const result = await service.createSchedule({
      deviceId: requireString(body, "device_id"),
      type: parseTaskType(requireString(body, "type")),
      recurrence: parseScheduleRecurrence(requireString(body, "recurrence")),
      startAt: requireString(body, "start_at"),
      timeZone: requireString(body, "time_zone"),
      idempotencyKey: requireHeader(request, "idempotency-key")
    });
    return writeJson(response, result.created ? 201 : 200, { status: "success", data: serializeSchedule(result.schedule), meta: { created: result.created } }, options.corsOrigin);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/admin/schedules") {
    const schedules = await service.listSchedules(readPage(url), readPageSize(url));
    return writeJson(response, 200, { status: "success", data: schedules.items.map(serializeSchedule), meta: pageMeta(schedules) }, options.corsOrigin);
  }

  const deleteScheduleMatch = url.pathname.match(/^\/api\/v1\/admin\/schedules\/([^/]+)$/);
  if (request.method === "DELETE" && deleteScheduleMatch) {
    const schedule = await service.cancelSchedule(decodeURIComponent(deleteScheduleMatch[1]));
    return writeJson(response, 200, { status: "success", data: serializeSchedule(schedule) }, options.corsOrigin);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/admin/logs") {
    const logs = await service.listLogs({
      deviceId: url.searchParams.get("device_id") ?? undefined,
      level: url.searchParams.get("level") ? parseLogLevel(url.searchParams.get("level") as string) : undefined,
      limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
      page: readPage(url),
      pageSize: url.searchParams.has("page_size") ? readPageSize(url) : undefined
    });
    return writeJson(response, 200, { status: "success", data: logs.items.map(serializeLog), meta: pageMeta(logs) }, options.corsOrigin);
  }

  const cancelTaskMatch = url.pathname.match(/^\/api\/v1\/admin\/tasks\/([^/]+):cancel$/);
  if (request.method === "POST" && cancelTaskMatch) {
    const task = await service.cancelTask(decodeURIComponent(cancelTaskMatch[1]));
    return writeJson(response, 200, { status: "success", data: serializeTask(task) }, options.corsOrigin);
  }

  const revokeMatch = url.pathname.match(/^\/api\/v1\/admin\/devices\/([^/]+):revoke$/);
  if (request.method === "POST" && revokeMatch) {
    const device = await service.revokeDevice(decodeURIComponent(revokeMatch[1]));
    return writeJson(response, 200, { status: "success", data: serializeDevice(device) }, options.corsOrigin);
  }

  if (request.method === "GET" && options.adminDistPath && !url.pathname.startsWith("/api/")) {
    return serveAdmin(response, options.adminDistPath, url.pathname);
  }

  throw new ApiError(404, "not_found", "Route was not found");
}

async function authenticateDevice(request: IncomingMessage, service: CollectionService, options: ServerOptions) {
  if (!isAuthEnabled(options)) {
    const deviceId = request.headers["x-device-id"];
    if (typeof deviceId !== "string" || !deviceId) throw new ApiError(401, "device_not_registered", "Development device is not registered");
    return service.authenticateDevelopmentDevice(deviceId);
  }
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) throw new ApiError(401, "invalid_token", "Bearer token is required");
  return service.authenticate(authorization.slice(7));
}

function requireAdmin(request: IncomingMessage, options: ServerOptions): void {
  if (!isAuthEnabled(options)) return;
  if (!options.adminApiKey) throw new ApiError(503, "admin_not_configured", "Admin API key is not configured");
  if (request.headers["x-admin-key"] !== options.adminApiKey) throw new ApiError(403, "admin_forbidden", "Admin access is forbidden");
}

function isAuthEnabled(options: ServerOptions): boolean {
  return options.authEnabled ?? Boolean(options.adminApiKey);
}

function parseSnapshotInput(value: unknown): Omit<ProjectSnapshot, "id" | "runId" | "normalizedProjectUrl" | "contentHash"> {
  const item = requireObject(value, "item");
  const status = requireString(item, "status");
  if (status !== "success" && status !== "failed") throw invalidPayload("status must be success or failed");
  return {
    projectUrl: requireString(item, "project_url"),
    rank: requireInteger(item, "rank"),
    name: requireString(item, "name"),
    readmeHtml: optionalString(item, "readme_html"),
    readmeText: optionalString(item, "readme_text"),
    readAt: requireString(item, "read_at"),
    status,
    errorCode: optionalString(item, "error_code") || undefined
  };
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  let content = "";
  for await (const chunk of request) content += chunk;
  if (!content) return {};
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw invalidPayload("request body must be valid JSON");
  }
}

function requireHeader(request: IncomingMessage, name: string): string {
  const value = request.headers[name];
  if (typeof value !== "string" || value.trim() === "") throw invalidPayload(`${name} header is required`);
  return value;
}

function serializeRegistration(result: Awaited<ReturnType<CollectionService["registerDevice"]>>) {
  return { device: serializeDevice(result.device), ...serializeTokens(result.tokens) };
}

function serializeTokens(tokens: { accessToken: string; accessTokenExpiresAt: string; refreshToken: string; refreshTokenExpiresAt: string }) {
  return {
    access_token: tokens.accessToken,
    access_token_expires_at: tokens.accessTokenExpiresAt,
    refresh_token: tokens.refreshToken,
    refresh_token_expires_at: tokens.refreshTokenExpiresAt
  };
}

function serializeDevice(device: { id: string; name: string; extensionVersion: string; registeredAt: string; lastHeartbeatAt?: string; queueDepth: number; status: string; revokedAt?: string }) {
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

function serializeAuthorization(authorization: RegistrationCode) {
  const now = Date.now();
  const status = authorization.revokedAt ? "revoked" : authorization.usedAt ? "used" : authorization.expiresAt && new Date(authorization.expiresAt).getTime() <= now ? "expired" : "active";
  return {
    id: authorization.id,
    code_hint: authorization.codeHint ?? "legacy",
    status,
    created_at: authorization.createdAt,
    expires_at: authorization.expiresAt,
    used_at: authorization.usedAt,
    device_id: authorization.deviceId
  };
}

function readPage(url: URL): number {
  const value = Number(url.searchParams.get("page") ?? 1);
  return Number.isFinite(value) ? value : 1;
}

function readPageSize(url: URL): number {
  const value = Number(url.searchParams.get("page_size") ?? 20);
  return Number.isFinite(value) ? value : 20;
}

function pageMeta(page: { total: number; page: number; pageSize: number; totalPages: number }) {
  return { total: page.total, page: page.page, page_size: page.pageSize, total_pages: page.totalPages };
}

function serializeTask(task: CollectionTask) {
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

function serializeSchedule(schedule: TaskSchedule) {
  return {
    id: schedule.id,
    device_id: schedule.deviceId,
    type: schedule.type,
    recurrence: schedule.recurrence,
    status: schedule.status,
    start_at: schedule.startAt,
    next_run_at: schedule.nextRunAt,
    time_zone: schedule.timeZone,
    created_at: schedule.createdAt,
    last_triggered_at: schedule.lastTriggeredAt,
    completed_at: schedule.completedAt,
    cancelled_at: schedule.cancelledAt
  };
}

function serializeLog(log: { id: string; deviceId: string; taskId?: string; level: string; event: string; message: string; metadata?: Record<string, unknown>; occurredAt: string }) {
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

function parseTaskType(value: string): TaskType {
  if (value !== "capture_trending") throw invalidPayload("type must be capture_trending");
  return value;
}

function parseTaskStatus(value: string): TaskStatus {
  const values: TaskStatus[] = ["pending", "running", "paused", "completed", "failed", "cancelled"];
  if (!values.includes(value as TaskStatus)) throw invalidPayload("status is invalid");
  return value as TaskStatus;
}

function parseScheduleRecurrence(value: string): ScheduleRecurrence {
  if (value !== "once" && value !== "daily") throw invalidPayload("recurrence must be once or daily");
  return value;
}

function parseAuthorizationExpiry(value: string): AuthorizationExpiry {
  const values: AuthorizationExpiry[] = ["24h", "7d", "30d", "never"];
  if (!values.includes(value as AuthorizationExpiry)) throw invalidPayload("expires_in must be 24h, 7d, 30d, or never");
  return value as AuthorizationExpiry;
}

function parseLogLevel(value: string): RuntimeLogLevel {
  const values: RuntimeLogLevel[] = ["info", "warn", "error"];
  if (!values.includes(value as RuntimeLogLevel)) throw invalidPayload("level is invalid");
  return value as RuntimeLogLevel;
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown, corsOrigin: string): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": corsOrigin,
    "access-control-allow-headers": "content-type, authorization, idempotency-key, x-admin-key, x-device-id",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS"
  });
  response.end(statusCode === 204 ? undefined : JSON.stringify(payload));
}

function handleError(response: ServerResponse, error: unknown, corsOrigin: string): void {
  if (error instanceof ApiError) {
    writeJson(response, error.statusCode, { status: "error", code: error.code, message: error.message, retryable: error.retryable }, corsOrigin);
    return;
  }
  console.error("Unhandled API error", error);
  writeJson(response, 500, { status: "error", code: "internal_error", message: "Internal server error", retryable: true }, corsOrigin);
}

async function serveAdmin(response: ServerResponse, rootPath: string, pathname: string): Promise<void> {
  const root = resolve(rootPath);
  const requestedPath = resolve(root, `.${decodeURIComponent(pathname)}`);
  const safePath = requestedPath === root || requestedPath.startsWith(`${root}${sep}`) ? requestedPath : resolve(root, "index.html");
  let filePath = safePath;
  try {
    if (!(await stat(filePath)).isFile()) filePath = resolve(root, "index.html");
  } catch {
    filePath = resolve(root, "index.html");
  }
  try {
    const content = await readFile(filePath);
    response.writeHead(200, { "content-type": contentType(filePath), "cache-control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable" });
    response.end(content);
  } catch {
    throw new ApiError(404, "admin_not_built", "Admin application is not available");
  }
}

function contentType(filePath: string): string {
  return ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" } as Record<string, string>)[extname(filePath)] ?? "application/octet-stream";
}
