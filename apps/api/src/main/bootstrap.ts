import type { Server } from "node:http";
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
  await options.store.initialize(options.bootstrapRegistrationCode);
  const server = createApiServer({ ...options, startWorkers: false });
  let closed = false;
  return {
    server,
    async start(): Promise<void> {
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
