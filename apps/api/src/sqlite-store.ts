import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createId, hashSecret } from "./crypto.js";
import { hydrateStoreData, snapshotEntities, STORE_COLLECTIONS, type StoredEntityRow } from "./entity-store.js";
import type { StoreData } from "./models.js";
import type { Store } from "./store.js";

const BOOTSTRAP_CODE_TTL_MS = 24 * 60 * 60 * 1000;
const MIGRATION_VERSION = 1;

interface SqliteEntityRow {
  collection: string;
  entity_id: string;
  payload: string;
}

export class SqliteStore implements Store {
  private database?: DatabaseSync;
  private operation = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async initialize(bootstrapCode?: string): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    this.database = new DatabaseSync(this.filePath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS automationhub_schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS automationhub_entities (
        collection TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (collection, entity_id)
      );
      INSERT OR IGNORE INTO automationhub_schema_migrations (version)
      VALUES (${MIGRATION_VERSION});
    `);

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
    let result!: StoreData;
    const next = this.operation.then(() => {
      result = this.readCurrent();
    });
    this.operation = next.catch(() => undefined);
    await next;
    return result;
  }

  async update<T>(mutation: (data: StoreData) => T): Promise<T> {
    let result!: T;
    const next = this.operation.then(() => {
      const database = this.getDatabase();
      database.exec("BEGIN IMMEDIATE");
      try {
        const data = this.readCurrent();
        const before = snapshotEntities(data);
        result = mutation(data);
        const after = snapshotEntities(data);
        const upsert = database.prepare(`
          INSERT INTO automationhub_entities (collection, entity_id, payload)
          VALUES (?, ?, ?)
          ON CONFLICT (collection, entity_id)
          DO UPDATE SET payload = excluded.payload, updated_at = CURRENT_TIMESTAMP
        `);
        const remove = database.prepare(
          "DELETE FROM automationhub_entities WHERE collection = ? AND entity_id = ?"
        );

        for (const collection of STORE_COLLECTIONS) {
          for (const [id, payload] of Object.entries(after[collection])) {
            if (before[collection][id] !== payload) upsert.run(collection, id, payload);
          }
          for (const id of Object.keys(before[collection])) {
            if (!(id in after[collection])) remove.run(collection, id);
          }
        }
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    });
    this.operation = next.catch(() => undefined);
    await next;
    return result;
  }

  async close(): Promise<void> {
    const next = this.operation.then(() => {
      this.database?.close();
      this.database = undefined;
    });
    this.operation = next.catch(() => undefined);
    await next;
  }

  private readCurrent(): StoreData {
    const rows = this.getDatabase()
      .prepare("SELECT collection, entity_id, payload FROM automationhub_entities ORDER BY collection, entity_id")
      .all() as unknown as SqliteEntityRow[];
    const entities: StoredEntityRow[] = rows.map((row) => ({
      collection: row.collection,
      entityId: row.entity_id,
      payload: JSON.parse(row.payload)
    }));
    return hydrateStoreData(entities);
  }

  private getDatabase(): DatabaseSync {
    if (!this.database) throw new Error("SqliteStore is not initialized");
    return this.database;
  }
}
