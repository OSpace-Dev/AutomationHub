import type { Server } from "node:http";
import { ApiKeyVault } from "../shared/crypto.js";
import { ModelProviderService, OpenAiCompatibleClient } from "../application/model-provider-service.js";
import { createApiServer, type ServerOptions } from "../http/server.js";
import type { Store } from "../application/ports/store.js";

export interface BootstrapOptions extends ServerOptions {
  store: Store;
  port: number;
  bootstrapRegistrationCode?: string;
}

export interface ApiApplication {
  server: Server;
  start(): Promise<void>;
  close(): Promise<void>;
}

export async function bootstrap(options: BootstrapOptions): Promise<ApiApplication> {
  const runtimeOptions = resolveRuntimeOptions(options);
  await runtimeOptions.store.initialize(runtimeOptions.bootstrapRegistrationCode);
  await seedLocalModelSandbox(runtimeOptions);
  const server = createApiServer({ ...runtimeOptions, startWorkers: false });
  let closed = false;
  return {
    server,
    async start(): Promise<void> {
      if (runtimeOptions.modelSandboxEnabled) {
        await new Promise<void>((resolve, reject) => {
          server.listen(options.port, () => resolve());
          server.once("error", reject);
        });
        await server.startWorkers();
        return;
      }
      await server.startWorkers();
      await new Promise<void>((resolve, reject) => {
        server.listen(options.port, () => resolve());
        server.once("error", reject);
      });
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve, reject) => {
        if (!server.listening) return resolve();
        server.close((error) => error ? reject(error) : resolve());
      });
      await options.store.close();
    }
  };
}

const LOCAL_MODEL_ENCRYPTION_KEY = "automationhub-local-development-only";

function resolveRuntimeOptions(options: BootstrapOptions): BootstrapOptions {
  if (!options.modelSandboxEnabled) return options;
  return {
    ...options,
    modelEncryptionKey: options.modelEncryptionKey?.trim() || LOCAL_MODEL_ENCRYPTION_KEY
  };
}

async function seedLocalModelSandbox(options: BootstrapOptions): Promise<void> {
  if (!options.modelSandboxEnabled) return;
  const providers = new ModelProviderService(options.store, new ApiKeyVault(options.modelEncryptionKey), new OpenAiCompatibleClient());
  if ((await providers.list()).length > 0) return;
  const baseUrl = `http://localhost:${options.port}/api/v1/mock-model/v1`;
  await providers.create({
    name: "本地开发模型",
    baseUrl,
    apiKey: "local-development-key",
    selectedModel: "mock-gpt-4o-mini",
    isDefault: true
  });
}
