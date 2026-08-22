import { createApiServer } from "./server.js";
import { PostgresStore } from "./postgres-store.js";
import { SqliteStore } from "./sqlite-store.js";
import { FileStore, type Store } from "./store.js";

const port = Number(process.env.PORT ?? 3000);
const storageDriver = process.env.STORAGE_DRIVER ?? (process.env.NODE_ENV === "production" ? "postgres" : "sqlite");
const store = createStore(storageDriver);
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
  server.close(async (error) => {
    await store.close();
    process.exit(error ? 1 : 0);
  });
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

function createStore(driver: string): Store {
  if (driver === "sqlite") {
    return new SqliteStore(process.env.SQLITE_FILE ?? "data/automationhub.sqlite");
  }
  if (driver === "file") {
    return new FileStore(process.env.DATA_FILE ?? "data/store.json");
  }
  if (driver !== "postgres") {
    throw new Error(`Unsupported STORAGE_DRIVER: ${driver}`);
  }
  if (!process.env.PGHOST || !process.env.PGDATABASE || !process.env.PGUSER || !process.env.PGPASSWORD) {
    throw new Error("PostgreSQL storage requires PGHOST, PGDATABASE, PGUSER and PGPASSWORD");
  }
  const port = parsePort(process.env.PGPORT);
  return new PostgresStore({
    host: process.env.PGHOST,
    port,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    max: parsePoolSize(process.env.PGPOOL_MAX)
  });
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 5432;
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65_535) return parsed;
  throw new Error("Invalid PGPORT");
}

function parsePoolSize(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 10;
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 100) return parsed;
  throw new Error("Invalid PGPOOL_MAX");
}
