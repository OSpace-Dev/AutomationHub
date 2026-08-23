import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { ApiKeyVault, SecretVault } from "../shared/crypto.js";
import { ApiError } from "../shared/errors.js";
import { authenticateDevice, requireAdmin } from "./auth.js";
import { routeAdminCore } from "./routes/admin-core.js";
import { routeAdminModels } from "./routes/admin-models.js";
import { routeAdminNotifications } from "./routes/admin-notifications.js";
import { routeAdminReports } from "./routes/admin-reports.js";
import { routeAdminTasks } from "./routes/admin-tasks.js";
import { routeCollection } from "./routes/collection.js";
import { routeDevices } from "./routes/devices.js";
import { routeCore } from "./router.js";
import { handleError, writeJson } from "./response.js";
import type { HttpContext } from "./context.js";
import { ModelProviderService, OpenAiCompatibleClient } from "../application/model-provider-service.js";
import { ReportDeliveryService } from "../application/report-delivery-service.js";
import { ReportGenerationService } from "../application/report-generation-service.js";
import { CollectionService, type AuthorizationExpiry } from "../application/collection-service.js";
import type { Store } from "../application/ports/store.js";
import { TelegramClient, type TelegramProxyRequest } from "../infrastructure/notifications/telegram-client.js";
import { StoreBackedNotificationPersistenceAdapter } from "../infrastructure/persistence/store-backed-notification-persistence-adapter.js";
import { StoreBackedReportPersistenceAdapter } from "../infrastructure/persistence/store-backed-report-persistence-adapter.js";

export interface ServerOptions {
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
  startWorkers?: boolean;
}

export interface ApiServer extends Server {
  startWorkers(): Promise<void>;
}

export function createApiServer(options: ServerOptions): ApiServer {
  const service = new CollectionService(options.store);
  const providers = new ModelProviderService(options.store, new ApiKeyVault(options.modelEncryptionKey), new OpenAiCompatibleClient(options.modelFetch ?? fetch));
  const reportPersistence = new StoreBackedReportPersistenceAdapter(options.store);
  const notificationPersistence = new StoreBackedNotificationPersistenceAdapter(options.store);
  const deliveries = new ReportDeliveryService(
    notificationPersistence,
    new SecretVault(options.modelEncryptionKey),
    new TelegramClient({
      requestFetch: options.telegramFetch ?? fetch,
      requestProxy: options.telegramProxyRequest
    }),
    options.publicBaseUrl
  );
  const reports = new ReportGenerationService(reportPersistence, providers, {
    modelRequestMinIntervalMs: options.modelRequestMinIntervalMs,
    onCompletedReport: async (generationId) => {
      await deliveries.enqueueForCompletedReport(generationId);
    }
  });
  const startWorkers = options.startWorkers !== false;
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
  const apiServer = server as ApiServer;
  apiServer.startWorkers = () => startWorkerServices(reports, deliveries);
  void (startWorkers ? apiServer.startWorkers() : Promise.resolve());
  return apiServer;
}

async function routeRequest(request: IncomingMessage, response: ServerResponse, service: CollectionService, providers: ModelProviderService, reports: ReportGenerationService, deliveries: ReportDeliveryService, options: ServerOptions): Promise<void> {
  if (request.method === "OPTIONS") return writeJson(response, 204, {}, options.corsOrigin);
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  const context: HttpContext = { request, response, url, service, providers, reports, deliveries, options };
  if (await routeCore(context)) return;
  if (requiresDeviceAuth(request, url)) context.auth = await authenticateDevice(request, service, options);
  if (await routeDevices(context)) return;
  if (await routeCollection(context)) return;

  if (requiresAdminAuth(request, url)) context.auth = requireAdmin(request, options);
  if (await routeAdminCore(context)) return;
  if (await routeAdminModels(context)) return;

  if (await routeAdminNotifications(context)) return;
  if (await routeAdminReports(context)) return;

  if (await routeAdminTasks(context)) return;

  throw new ApiError(404, "not_found", "Route was not found");
}

async function startWorkerServices(reports: ReportGenerationService, deliveries: ReportDeliveryService): Promise<void> {
  await reports.start();
  await deliveries.start();
}

function requiresDeviceAuth(request: IncomingMessage, url: URL): boolean {
  if (request.method !== "POST") return false;
  return url.pathname === "/api/v1/devices/heartbeat"
    || url.pathname === "/api/v1/devices/tasks:claim"
    || /^\/api\/v1\/devices\/tasks\/[^/]+:status$/.test(url.pathname)
    || url.pathname === "/api/v1/devices/logs"
    || url.pathname === "/api/v1/collection-runs"
    || /^\/api\/v1\/collection-runs\/[^/]+\/items:batch$/.test(url.pathname);
}

function requiresAdminAuth(request: IncomingMessage, url: URL): boolean {
  return url.pathname.startsWith("/api/v1/admin/") && url.pathname !== "/api/v1/admin/auth-status";
}
