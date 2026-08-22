import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { ApiKeyVault, SecretVault } from "./crypto.js";
import { ApiError, invalidPayload } from "./errors.js";
import type { CollectionTask, NotificationTarget, ProjectSnapshot, RegistrationCode, ReportGeneration, ReportGenerationStatus, ReportGenerationTrigger, ReportInsights, RuntimeLogLevel, ScheduleRecurrence, ScheduleStatus, TaskSchedule, TaskStatus, TaskType } from "./models.js";
import { ModelProviderService, OpenAiCompatibleClient } from "./model-service.js";
import { ReportDeliveryService, type NotificationChannelInput, type NotificationTargetInput } from "./notification-service.js";
import { ReportGenerationService } from "./report-service.js";
import { CollectionService, type AuthorizationExpiry } from "./service.js";
import type { Store } from "./store.js";
import { TelegramClient, type TelegramProxyRequest } from "./telegram-service.js";
import { optionalNonNegativeInteger, optionalString, requireInteger, requireObject, requireString } from "./validation.js";

interface ServerOptions {
  store: Store;
  adminApiKey?: string;
  corsOrigin: string;
  authEnabled?: boolean;
  adminDistPath?: string;
  modelEncryptionKey?: string;
  publicBaseUrl?: string;
  modelFetch?: typeof fetch;
  telegramFetch?: typeof fetch;
  telegramProxyRequest?: TelegramProxyRequest;
  modelRequestMinIntervalMs?: number;
}

export function createApiServer(options: ServerOptions): Server {
  const service = new CollectionService(options.store);
  const providers = new ModelProviderService(options.store, new ApiKeyVault(options.modelEncryptionKey), new OpenAiCompatibleClient(options.modelFetch ?? fetch));
  const deliveries = new ReportDeliveryService(
    options.store,
    new SecretVault(options.modelEncryptionKey),
    new TelegramClient({
      requestFetch: options.telegramFetch ?? fetch,
      requestProxy: options.telegramProxyRequest
    }),
    options.publicBaseUrl
  );
  const reports = new ReportGenerationService(options.store, providers, {
    modelRequestMinIntervalMs: options.modelRequestMinIntervalMs,
    onCompletedReport: async (generationId) => {
      await deliveries.enqueueForCompletedReport(generationId);
    }
  });
  void reports.start();
  void deliveries.start();
  const server = createServer(async (request, response) => {
    try {
      await routeRequest(request, response, service, providers, reports, deliveries, options);
    } catch (error) {
      handleError(response, error, options.corsOrigin);
    }
  });
  server.on("close", () => {
    reports.stop();
    deliveries.stop();
  });
  return server;
}

async function routeRequest(request: IncomingMessage, response: ServerResponse, service: CollectionService, providers: ModelProviderService, reports: ReportGenerationService, deliveries: ReportDeliveryService, options: ServerOptions): Promise<void> {
  if (request.method === "OPTIONS") return writeJson(response, 204, {}, options.corsOrigin);
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "GET" && url.pathname === "/health") {
    return writeJson(response, 200, { status: "ok", service: "automation-hub-api" }, options.corsOrigin);
  }

  const publicReportMatch = url.pathname.match(/^\/api\/v1\/public\/reports\/([^/]+)$/);
  if (request.method === "GET" && publicReportMatch) {
    const report = await reports.getPublic(decodeURIComponent(publicReportMatch[1]));
    return writeJson(response, 200, { status: "success", data: serializePublicReport(report) }, options.corsOrigin);
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
    if (task.status === "completed") {
      try {
        await reports.enqueueAutomatic(task.runId);
      } catch (error) {
        console.error("Automatic report enqueue failed", error instanceof ApiError ? error.code : "unknown_error");
      }
    }
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

  if (request.method === "GET" && url.pathname === "/api/v1/admin/auth-status") {
    return writeJson(response, 200, {
      status: "success",
      data: { auth_enabled: isAuthEnabled(options), key_configured: Boolean(options.adminApiKey) }
    }, options.corsOrigin);
  }

  if (url.pathname.startsWith("/api/v1/admin/")) requireAdmin(request, options);
  if (request.method === "GET" && url.pathname === "/api/v1/admin/session") {
    return writeJson(response, 200, { status: "success", data: { authenticated: true } }, options.corsOrigin);
  }
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

  if (request.method === "GET" && url.pathname === "/api/v1/admin/model-providers") {
    const modelProviders = await providers.list();
    return writeJson(response, 200, { status: "success", data: modelProviders.map(serializeModelProvider) }, options.corsOrigin);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/admin/model-providers") {
    const body = requireObject(await readJson(request));
    const provider = await providers.create({
      name: requireString(body, "name"),
      baseUrl: requireString(body, "base_url"),
      apiKey: requireString(body, "api_key"),
      selectedModel: requireString(body, "selected_model"),
      isDefault: optionalBoolean(body, "is_default", true)
    });
    return writeJson(response, 201, { status: "success", data: serializeModelProvider(provider) }, options.corsOrigin);
  }

  const modelProviderMatch = url.pathname.match(/^\/api\/v1\/admin\/model-providers\/([^/:]+)$/);
  if (request.method === "PUT" && modelProviderMatch) {
    const body = requireObject(await readJson(request));
    const provider = await providers.update(decodeURIComponent(modelProviderMatch[1]), {
      name: body.name === undefined ? undefined : requireString(body, "name"),
      baseUrl: body.base_url === undefined ? undefined : requireString(body, "base_url"),
      apiKey: body.api_key === undefined ? undefined : optionalString(body, "api_key") || undefined,
      selectedModel: body.selected_model === undefined ? undefined : requireString(body, "selected_model"),
      isDefault: body.is_default === undefined ? undefined : optionalBoolean(body, "is_default")
    });
    return writeJson(response, 200, { status: "success", data: serializeModelProvider(provider) }, options.corsOrigin);
  }

  if (request.method === "DELETE" && modelProviderMatch) {
    const provider = await providers.remove(decodeURIComponent(modelProviderMatch[1]));
    return writeJson(response, 200, { status: "success", data: serializeModelProvider(provider) }, options.corsOrigin);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/admin/model-providers/models:fetch") {
    const body = requireObject(await readJson(request));
    const models = await providers.fetchModels({
      providerId: optionalString(body, "provider_id") || undefined,
      baseUrl: optionalString(body, "base_url") || undefined,
      apiKey: optionalString(body, "api_key") || undefined
    });
    return writeJson(response, 200, { status: "success", data: models }, options.corsOrigin);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/admin/notification-channels") {
    const channels = await deliveries.listChannels();
    return writeJson(response, 200, { status: "success", data: channels.map(serializeNotificationChannel) }, options.corsOrigin);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/admin/notification-channels") {
    const body = requireObject(await readJson(request));
    const type = optionalString(body, "type") || "telegram";
    if (type !== "telegram") throw invalidPayload("type must be telegram");
    const channel = await deliveries.createChannel({
      name: requireString(body, "name"),
      botToken: requireString(body, "bot_token"),
      proxyUrl: body.proxy_url === undefined ? undefined : optionalString(body, "proxy_url"),
      proxyEnabled: optionalBoolean(body, "proxy_enabled", false),
      enabled: optionalBoolean(body, "enabled", true)
    });
    return writeJson(response, 201, { status: "success", data: serializeNotificationChannel(channel) }, options.corsOrigin);
  }

  const notificationChannelVerifyMatch = url.pathname.match(/^\/api\/v1\/admin\/notification-channels\/([^/:]+):verify$/);
  if (request.method === "POST" && notificationChannelVerifyMatch) {
    const channel = await deliveries.verifyChannel(decodeURIComponent(notificationChannelVerifyMatch[1]));
    return writeJson(response, 200, { status: "success", data: serializeNotificationChannel(channel) }, options.corsOrigin);
  }

  const notificationChannelChatsMatch = url.pathname.match(/^\/api\/v1\/admin\/notification-channels\/([^/]+)\/chats$/);
  if (request.method === "GET" && notificationChannelChatsMatch) {
    const chats = await deliveries.discoverChats(decodeURIComponent(notificationChannelChatsMatch[1]));
    return writeJson(response, 200, { status: "success", data: chats.map(serializeTelegramChat) }, options.corsOrigin);
  }

  const notificationChatTestMatch = url.pathname.match(/^\/api\/v1\/admin\/notification-channels\/([^/]+)\/chats\/([^/:]+):test$/);
  if (request.method === "POST" && notificationChatTestMatch) {
    await deliveries.sendTestChat(
      decodeURIComponent(notificationChatTestMatch[1]),
      decodeURIComponent(notificationChatTestMatch[2])
    );
    return writeJson(response, 200, { status: "success", data: { sent: true } }, options.corsOrigin);
  }

  const notificationChannelTargetsMatch = url.pathname.match(/^\/api\/v1\/admin\/notification-channels\/([^/]+)\/targets$/);
  if (request.method === "GET" && notificationChannelTargetsMatch) {
    const targets = await deliveries.listTargets(decodeURIComponent(notificationChannelTargetsMatch[1]));
    return writeJson(response, 200, { status: "success", data: targets.map(serializeNotificationTarget) }, options.corsOrigin);
  }
  if (request.method === "POST" && notificationChannelTargetsMatch) {
    const body = requireObject(await readJson(request));
    const target = await deliveries.createTarget(decodeURIComponent(notificationChannelTargetsMatch[1]), {
      name: requireString(body, "name"),
      chatId: requireString(body, "chat_id"),
      enabled: optionalBoolean(body, "enabled", true)
    });
    return writeJson(response, 201, { status: "success", data: serializeNotificationTarget(target) }, options.corsOrigin);
  }

  const notificationTargetTestMatch = url.pathname.match(/^\/api\/v1\/admin\/notification-channels\/([^/]+)\/targets\/([^/:]+):test$/);
  if (request.method === "POST" && notificationTargetTestMatch) {
    await deliveries.sendTest(decodeURIComponent(notificationTargetTestMatch[1]), decodeURIComponent(notificationTargetTestMatch[2]));
    return writeJson(response, 200, { status: "success", data: { sent: true } }, options.corsOrigin);
  }

  const notificationTargetMatch = url.pathname.match(/^\/api\/v1\/admin\/notification-channels\/([^/]+)\/targets\/([^/]+)$/);
  if (request.method === "PUT" && notificationTargetMatch) {
    const body = requireObject(await readJson(request));
    const target = await deliveries.updateTarget(decodeURIComponent(notificationTargetMatch[1]), decodeURIComponent(notificationTargetMatch[2]), {
      name: body.name === undefined ? undefined : requireString(body, "name"),
      chatId: body.chat_id === undefined ? undefined : requireString(body, "chat_id"),
      enabled: body.enabled === undefined ? undefined : optionalBoolean(body, "enabled")
    });
    return writeJson(response, 200, { status: "success", data: serializeNotificationTarget(target) }, options.corsOrigin);
  }
  if (request.method === "DELETE" && notificationTargetMatch) {
    const target = await deliveries.removeTarget(decodeURIComponent(notificationTargetMatch[1]), decodeURIComponent(notificationTargetMatch[2]));
    return writeJson(response, 200, { status: "success", data: serializeNotificationTarget(target) }, options.corsOrigin);
  }

  const notificationChannelMatch = url.pathname.match(/^\/api\/v1\/admin\/notification-channels\/([^/]+)$/);
  if (request.method === "PUT" && notificationChannelMatch) {
    const body = requireObject(await readJson(request));
    const channel = await deliveries.updateChannel(decodeURIComponent(notificationChannelMatch[1]), {
      name: body.name === undefined ? undefined : requireString(body, "name"),
      botToken: body.bot_token === undefined ? undefined : optionalString(body, "bot_token") || undefined,
      proxyUrl: body.proxy_url === undefined ? undefined : optionalString(body, "proxy_url"),
      proxyEnabled: body.proxy_enabled === undefined ? undefined : optionalBoolean(body, "proxy_enabled"),
      enabled: body.enabled === undefined ? undefined : optionalBoolean(body, "enabled")
    });
    return writeJson(response, 200, { status: "success", data: serializeNotificationChannel(channel) }, options.corsOrigin);
  }
  if (request.method === "DELETE" && notificationChannelMatch) {
    const channel = await deliveries.removeChannel(decodeURIComponent(notificationChannelMatch[1]));
    return writeJson(response, 200, { status: "success", data: serializeNotificationChannel(channel) }, options.corsOrigin);
  }

  if (request.method === "GET" && url.pathname === "/api/v1/admin/reports") {
    const result = await reports.list({
      date: url.searchParams.get("date") ?? undefined,
      status: url.searchParams.get("status") ? parseReportStatus(url.searchParams.get("status") as string) : undefined,
      trigger: url.searchParams.get("trigger") ? parseReportTrigger(url.searchParams.get("trigger") as string) : undefined,
      page: readPage(url),
      pageSize: readPageSize(url)
    });
    return writeJson(response, 200, { status: "success", data: result.items.map((report) => serializeReportSummary(report, options.publicBaseUrl)), meta: pageMeta(result) }, options.corsOrigin);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/admin/reports") {
    const body = requireObject(await readJson(request));
    const generation = await reports.createManual(requireString(body, "run_id"));
    return writeJson(response, 202, { status: "success", data: serializeReport(generation, options.publicBaseUrl) }, options.corsOrigin);
  }

  const reportDeliveriesMatch = url.pathname.match(/^\/api\/v1\/admin\/reports\/([^/]+)\/deliveries$/);
  if (request.method === "GET" && reportDeliveriesMatch) {
    const reportDeliveries = await deliveries.listDeliveries(decodeURIComponent(reportDeliveriesMatch[1]));
    return writeJson(response, 200, { status: "success", data: reportDeliveries.map(serializeReportDelivery) }, options.corsOrigin);
  }
  if (request.method === "POST" && reportDeliveriesMatch) {
    const reportDeliveries = await deliveries.enqueueManual(decodeURIComponent(reportDeliveriesMatch[1]));
    return writeJson(response, 202, { status: "success", data: reportDeliveries.map(serializeReportDelivery) }, options.corsOrigin);
  }

  const reportDeliveryRetryMatch = url.pathname.match(/^\/api\/v1\/admin\/report-deliveries\/([^/:]+):retry$/);
  if (request.method === "POST" && reportDeliveryRetryMatch) {
    const delivery = await deliveries.retryDelivery(decodeURIComponent(reportDeliveryRetryMatch[1]));
    return writeJson(response, 202, { status: "success", data: serializeReportDelivery(delivery) }, options.corsOrigin);
  }

  const reportRetryMatch = url.pathname.match(/^\/api\/v1\/admin\/reports\/([^/:]+):retry$/);
  if (request.method === "POST" && reportRetryMatch) {
    const generation = await reports.retry(decodeURIComponent(reportRetryMatch[1]));
    return writeJson(response, 202, { status: "success", data: serializeReport(generation, options.publicBaseUrl) }, options.corsOrigin);
  }

  const reportDetailMatch = url.pathname.match(/^\/api\/v1\/admin\/reports\/([^/:]+)$/);
  if (request.method === "GET" && reportDetailMatch) {
    const generation = await reports.get(decodeURIComponent(reportDetailMatch[1]));
    return writeJson(response, 200, { status: "success", data: serializeReport(generation, options.publicBaseUrl) }, options.corsOrigin);
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
    const schedules = await service.listSchedules({
      deviceId: url.searchParams.get("device_id") ?? undefined,
      status: url.searchParams.get("status") ? parseScheduleStatus(url.searchParams.get("status") as string) : undefined,
      recurrence: url.searchParams.get("recurrence") ? parseScheduleRecurrence(url.searchParams.get("recurrence") as string) : undefined,
      page: readPage(url),
      pageSize: readPageSize(url)
    });
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
    description: optionalString(item, "description") || undefined,
    language: optionalString(item, "language") || undefined,
    totalStars: optionalNonNegativeInteger(item, "total_stars"),
    starsToday: optionalNonNegativeInteger(item, "stars_today"),
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

function optionalBoolean(object: Record<string, unknown>, field: string, fallback?: boolean): boolean {
  const value = object[field];
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "boolean") throw invalidPayload(`${field} must be a boolean`);
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

function serializeModelProvider(provider: { id: string; name: string; baseUrl: string; apiKeyConfigured: boolean; apiKeyHint: string; selectedModel: string; isDefault: boolean; status: string; lastModelsFetchedAt?: string; lastError?: string; createdAt: string; updatedAt: string }) {
  return {
    id: provider.id,
    name: provider.name,
    base_url: provider.baseUrl,
    api_key_configured: provider.apiKeyConfigured,
    api_key_hint: provider.apiKeyHint,
    selected_model: provider.selectedModel,
    is_default: provider.isDefault,
    status: provider.status,
    last_models_fetched_at: provider.lastModelsFetchedAt,
    last_error: provider.lastError,
    created_at: provider.createdAt,
    updated_at: provider.updatedAt
  };
}

function serializeNotificationChannel(channel: { id: string; type: string; name: string; botTokenConfigured: boolean; botTokenHint: string; proxyConfigured: boolean; proxyUrlHint?: string; proxyEnabled: boolean; botUsername?: string; botDisplayName?: string; enabled: boolean; lastVerifiedAt?: string; lastError?: string; createdAt: string; updatedAt: string }) {
  return {
    id: channel.id,
    type: channel.type,
    name: channel.name,
    bot_token_configured: channel.botTokenConfigured,
    bot_token_hint: channel.botTokenHint,
    proxy_configured: channel.proxyConfigured,
    proxy_url_hint: channel.proxyUrlHint,
    proxy_enabled: channel.proxyEnabled,
    bot_username: channel.botUsername,
    bot_display_name: channel.botDisplayName,
    enabled: channel.enabled,
    last_verified_at: channel.lastVerifiedAt,
    last_error: channel.lastError,
    created_at: channel.createdAt,
    updated_at: channel.updatedAt
  };
}

function serializeNotificationTarget(target: NotificationTarget) {
  return {
    id: target.id,
    channel_id: target.channelId,
    name: target.name,
    chat_id: target.chatId,
    enabled: target.enabled,
    created_at: target.createdAt,
    updated_at: target.updatedAt
  };
}

function serializeTelegramChat(chat: { id: string; type: string; title?: string; username?: string; firstName?: string; lastName?: string; alreadyConfigured: boolean }) {
  return {
    id: chat.id,
    type: chat.type,
    title: chat.title,
    username: chat.username,
    first_name: chat.firstName,
    last_name: chat.lastName,
    already_configured: chat.alreadyConfigured
  };
}

function serializeReportDelivery(delivery: { id: string; reportGenerationId: string; channelId: string; channelName?: string; targetId: string; targetName?: string; chatId?: string; status: string; attemptCount: number; messageCount?: number; lastError?: string; createdAt: string; startedAt?: string; sentAt?: string; completedAt?: string }) {
  return {
    id: delivery.id,
    report_generation_id: delivery.reportGenerationId,
    channel_id: delivery.channelId,
    channel_name: delivery.channelName,
    target_id: delivery.targetId,
    target_name: delivery.targetName,
    chat_id: delivery.chatId,
    status: delivery.status,
    attempt_count: delivery.attemptCount,
    message_count: delivery.messageCount,
    last_error: delivery.lastError,
    created_at: delivery.createdAt,
    started_at: delivery.startedAt,
    sent_at: delivery.sentAt,
    completed_at: delivery.completedAt
  };
}

function serializeReport(report: ReportGeneration, publicBaseUrl?: string) {
  return {
    id: report.id,
    definition_id: report.definitionId,
    source_type: report.sourceType,
    business_date: report.businessDate,
    run_id: report.runId,
    trigger: report.trigger,
    status: report.status,
    provider_name: report.providerName,
    model: report.model,
    input_item_count: report.inputItemCount,
    attempt_count: report.attemptCount,
    content: report.content,
    insights: report.insights ? serializeReportInsights(report.insights) : undefined,
    error_code: report.errorCode,
    error_message: report.errorMessage,
    parent_generation_id: report.parentGenerationId,
    public_url: report.status === "completed" && report.shareToken && publicBaseUrl ? `${publicBaseUrl.replace(/\/+$/, "")}/share/reports/${encodeURIComponent(report.shareToken)}` : undefined,
    created_at: report.createdAt,
    started_at: report.startedAt,
    completed_at: report.completedAt
  };
}

function serializeReportSummary(report: Parameters<typeof serializeReport>[0], publicBaseUrl?: string) {
  const { content: _content, ...summary } = serializeReport(report, publicBaseUrl);
  return summary;
}

function serializePublicReport(report: { businessDate: string; sourceType: string; content: string; insights?: ReportInsights; completedAt?: string }) {
  return {
    business_date: report.businessDate,
    source_type: report.sourceType,
    content: report.content,
    insights: report.insights ? serializeReportInsights(report.insights) : undefined,
    completed_at: report.completedAt
  };
}

function serializeReportInsights(insights: ReportInsights) {
  const serializeProject = (project: ReportInsights["categories"][number]["projects"][number]) => ({
    project_url: project.projectUrl,
    name: project.name,
    rank: project.rank,
    category: project.category,
    purpose: project.purpose,
    attention_reason: project.attentionReason,
    description: project.description,
    language: project.language,
    total_stars: project.totalStars,
    stars_today: project.starsToday,
    total_stars_delta: project.totalStarsDelta
  });
  const serializeTrend = (project: ReportInsights["trends"]["newEntries"][number]) => ({
    project_url: project.projectUrl,
    name: project.name,
    current_rank: project.currentRank,
    previous_rank: project.previousRank,
    rank_change: project.rankChange,
    total_stars_delta: project.totalStarsDelta
  });
  return {
    presentation_version: insights.presentationVersion,
    overview: insights.overview,
    metrics: {
      project_count: insights.metrics.projectCount,
      total_stars: insights.metrics.totalStars,
      stars_today: insights.metrics.starsToday,
      category_count: insights.metrics.categoryCount,
      total_stars_delta: insights.metrics.totalStarsDelta,
      known_total_stars_count: insights.metrics.knownTotalStarsCount,
      known_stars_today_count: insights.metrics.knownStarsTodayCount,
      comparable_project_count: insights.metrics.comparableProjectCount,
      analysis_fallback_count: insights.metrics.analysisFallbackCount
    },
    categories: insights.categories.map((category) => ({
      key: category.key,
      label: category.label,
      project_count: category.projectCount,
      total_stars: category.totalStars,
      stars_today: category.starsToday,
      projects: category.projects.map(serializeProject)
    })),
    trends: {
      has_comparison: insights.trends.hasComparison,
      comparison_date: insights.trends.comparisonDate,
      new_entries: insights.trends.newEntries.map(serializeTrend),
      continued_entries: insights.trends.continuedEntries.map(serializeTrend),
      exited_entries: insights.trends.exitedEntries.map(serializeTrend),
      rising_entries: insights.trends.risingEntries.map(serializeTrend),
      falling_entries: insights.trends.fallingEntries.map(serializeTrend),
      unchanged_entries: insights.trends.unchangedEntries.map(serializeTrend)
    }
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

function parseScheduleStatus(value: string): ScheduleStatus {
  const values: ScheduleStatus[] = ["active", "completed", "cancelled"];
  if (!values.includes(value as ScheduleStatus)) throw invalidPayload("schedule status is invalid");
  return value as ScheduleStatus;
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

function parseReportStatus(value: string): ReportGenerationStatus {
  const values: ReportGenerationStatus[] = ["pending", "running", "completed", "failed"];
  if (!values.includes(value as ReportGenerationStatus)) throw invalidPayload("status is invalid");
  return value as ReportGenerationStatus;
}

function parseReportTrigger(value: string): ReportGenerationTrigger {
  const values: ReportGenerationTrigger[] = ["automatic", "manual", "retry"];
  if (!values.includes(value as ReportGenerationTrigger)) throw invalidPayload("trigger is invalid");
  return value as ReportGenerationTrigger;
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown, corsOrigin: string): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": corsOrigin,
    "access-control-allow-headers": "content-type, authorization, idempotency-key, x-admin-key, x-device-id",
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS"
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
