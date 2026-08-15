import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createId, hashSecret } from "./crypto.js";
import { EMPTY_STORE, type StoreData } from "./models.js";

const BOOTSTRAP_CODE_TTL_MS = 24 * 60 * 60 * 1000;

export interface Store {
  initialize(bootstrapCode?: string): Promise<void>;
  read(): Promise<StoreData>;
  update<T>(mutation: (data: StoreData) => T): Promise<T>;
}

export class FileStore implements Store {
  private operation = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async initialize(bootstrapCode?: string): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.write(structuredClone(EMPTY_STORE));
    }

    if (bootstrapCode) {
      await this.update((data) => {
        const codeHash = hashSecret(bootstrapCode);
        if (!data.registrationCodes.some((entry) => entry.codeHash === codeHash)) {
          data.registrationCodes.push({
            id: createId(),
            codeHash,
            codeHint: "BOOTSTRAP",
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + BOOTSTRAP_CODE_TTL_MS).toISOString()
          });
        }
      });
    }
  }

  async read(): Promise<StoreData> {
    const content = await readFile(this.filePath, "utf8");
    const parsed = JSON.parse(content) as Partial<StoreData>;
    return {
      ...structuredClone(EMPTY_STORE),
      ...parsed,
      devices: parsed.devices ?? [],
      tokens: parsed.tokens ?? [],
      runs: parsed.runs ?? [],
      items: parsed.items ?? [],
      tasks: parsed.tasks ?? [],
      schedules: parsed.schedules ?? [],
      logs: parsed.logs ?? [],
      registrationCodes: parsed.registrationCodes ?? []
    };
  }

  async update<T>(mutation: (data: StoreData) => T): Promise<T> {
    let result!: T;
    const next = this.operation.then(async () => {
      const data = await this.read();
      result = mutation(data);
      await this.write(data);
    });
    this.operation = next.catch(() => undefined);
    await next;
    return result;
  }

  private async write(data: StoreData): Promise<void> {
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(data, null, 2), "utf8");
    await rename(temporaryPath, this.filePath);
  }
}
