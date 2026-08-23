import { PostgresStore } from "../infrastructure/persistence/postgres-store.js";
import { SqliteStore } from "../infrastructure/persistence/sqlite-store.js";
import { FileStore } from "../infrastructure/persistence/file-store.js";
import type { Store } from "../application/ports/store.js";

export interface ApiConfig {
  port: number;
  store: Store;
  adminApiKey?: string;
  authEnabled: boolean;
  corsOrigin: string;
  adminDistPath?: string;
  modelEncryptionKey?: string;
  publicBaseUrl?: string;
  modelRequestMinIntervalMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const port = Number(env.PORT ?? 3000);
  const storageDriver = env.STORAGE_DRIVER ?? (env.NODE_ENV === "production" ? "postgres" : "sqlite");
  const adminApiKey = env.ADMIN_API_KEY;
  const authEnabled = parseAuthEnabled(env.AUTH_ENABLED, adminApiKey);
  return {
    port,
    store: createStore(storageDriver, env),
    adminApiKey,
    authEnabled,
    corsOrigin: env.CORS_ORIGIN ?? "http://localhost:5173",
    adminDistPath: env.ADMIN_DIST_PATH,
    modelEncryptionKey: env.MODEL_CONFIG_ENCRYPTION_KEY,
    publicBaseUrl: env.PUBLIC_BASE_URL,
    modelRequestMinIntervalMs: parseModelRequestMinInterval(env.MODEL_REQUEST_MIN_INTERVAL_MS)
  };
}

export function parseAuthEnabled(value: string | undefined, adminApiKey: string | undefined): boolean {
  if (value === undefined || value.trim() === "") return Boolean(adminApiKey?.trim());
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("AUTH_ENABLED must be true or false");
}

export function parseModelRequestMinInterval(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 60_000;
  const parsed = Number(value);
  if (Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 2_147_483_647) return parsed;
  console.warn("Invalid MODEL_REQUEST_MIN_INTERVAL_MS; using 60000ms");
  return 60_000;
}

function createStore(driver: string, env: NodeJS.ProcessEnv): Store {
  if (driver === "sqlite") return new SqliteStore(env.SQLITE_FILE ?? "data/automationhub.sqlite");
  if (driver === "file") return new FileStore(env.DATA_FILE ?? "data/store.json");
  if (driver !== "postgres") throw new Error(`Unsupported STORAGE_DRIVER: ${driver}`);
  if (!env.PGHOST || !env.PGDATABASE || !env.PGUSER || !env.PGPASSWORD) {
    throw new Error("PostgreSQL storage requires PGHOST, PGDATABASE, PGUSER and PGPASSWORD");
  }
  return new PostgresStore({
    host: env.PGHOST,
    port: parsePort(env.PGPORT),
    database: env.PGDATABASE,
    user: env.PGUSER,
    password: env.PGPASSWORD,
    max: parsePoolSize(env.PGPOOL_MAX)
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
