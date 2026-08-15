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
  adminDistPath: process.env.ADMIN_DIST_PATH
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
