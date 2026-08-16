import { createApiServer } from "./server.js";
import { FileStore } from "./store.js";

const port = Number(process.env.PORT ?? 3000);
const dataFile = process.env.DATA_FILE ?? "data/store.json";
const store = new FileStore(dataFile);
const authEnabled = process.env.AUTH_ENABLED
  ? process.env.AUTH_ENABLED === "true"
  : Boolean(process.env.ADMIN_API_KEY);

await store.initialize(authEnabled ? process.env.BOOTSTRAP_REGISTRATION_CODE : undefined);

const server = createApiServer({
  store,
  adminApiKey: process.env.ADMIN_API_KEY,
  authEnabled,
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  adminDistPath: process.env.ADMIN_DIST_PATH,
  modelEncryptionKey: process.env.MODEL_CONFIG_ENCRYPTION_KEY,
  publicBaseUrl: process.env.PUBLIC_BASE_URL,
  modelRequestMinIntervalMs: parseModelRequestMinInterval(process.env.MODEL_REQUEST_MIN_INTERVAL_MS)
});

server.listen(port, () => {
  console.log(`AutomationHub API listening on http://localhost:${port}`);
});

function shutdown(signal: string): void {
  console.log(`${signal} received, shutting down`);
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

function parseModelRequestMinInterval(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 60_000;
  const parsed = Number(value);
  if (Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 2_147_483_647) return parsed;
  console.warn("Invalid MODEL_REQUEST_MIN_INTERVAL_MS; using 60000ms");
  return 60_000;
}
