import { bootstrap } from "./bootstrap.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const { store } = config;

const application = await bootstrap({
  port: config.port,
  store,
  adminApiKey: config.adminApiKey,
  authEnabled: config.authEnabled,
  modelSandboxEnabled: config.modelSandboxEnabled,
  corsOrigin: config.corsOrigin,
  adminDistPath: config.adminDistPath,
  modelEncryptionKey: config.modelEncryptionKey,
  publicBaseUrl: config.publicBaseUrl,
  modelRequestMinIntervalMs: config.modelRequestMinIntervalMs,
  bootstrapRegistrationCode: config.authEnabled ? process.env.BOOTSTRAP_REGISTRATION_CODE : undefined
});

await application.start();
console.log(`AutomationHub API listening on http://localhost:${config.port}`);

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received, shutting down`);
  try {
    await application.close();
    process.exit(0);
  } catch {
    process.exit(1);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
