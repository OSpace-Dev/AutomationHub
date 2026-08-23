import { Pool, type PoolConfig } from "pg";
import { createId, hashSecret } from "../../shared/crypto.js";
import {
  hydrateStoreData,
  snapshotEntities,
  STORE_COLLECTIONS,
  type StoredEntityRow
} from "./entity-store.js";
import type { StoreData } from "../../domain/models.js";
import type { Store } from "../../application/ports/store.js";

const BOOTSTRAP_CODE_TTL_MS = 24 * 60 * 60 * 1000;
const MIGRATION_LOCK_KEY = 7_431_002_026;
const UPDATE_LOCK_KEY = 7_431_002_027;
const MIGRATION_VERSION = 1;

interface EntityRow {
  collection: string;
  entity_id: string;
  payload: unknown;
}

export class PostgresStore implements Store {
  private readonly pool: Pool;

  constructor(config: PoolConfig) {
    this.pool = new Pool({
      ...config,
      application_name: config.application_name ?? "automationhub-api"
    });
  }

  async initialize(bootstrapCode?: string): Promise<void> {
    await this.migrate();
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
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const result = await client.query<EntityRow>(
        "SELECT collection, entity_id, payload FROM automationhub_entities ORDER BY collection, entity_id"
      );
      const data = hydrateStoreData(toStoredEntityRows(result.rows));
      await client.query("COMMIT");
      return data;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async update<T>(mutation: (data: StoreData) => T): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [UPDATE_LOCK_KEY]);
      const data = await loadStoreData(client);
      const beforeJson = snapshotEntities(data);
      const result = mutation(data);
      const afterJson = snapshotEntities(data);

      for (const collection of STORE_COLLECTIONS) {
        const beforeCollection = beforeJson[collection];
        const afterCollection = afterJson[collection];
        for (const [id, payload] of Object.entries(afterCollection)) {
          if (beforeCollection[id] !== payload) {
            await client.query(
              `INSERT INTO automationhub_entities (collection, entity_id, payload)
               VALUES ($1, $2, $3::jsonb)
               ON CONFLICT (collection, entity_id)
               DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
              [collection, id, payload]
            );
          }
        }
        for (const id of Object.keys(beforeCollection)) {
          if (!(id in afterCollection)) {
            await client.query(
              "DELETE FROM automationhub_entities WHERE collection = $1 AND entity_id = $2",
              [collection, id]
            );
          }
        }
      }

      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async migrate(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);
      await client.query(`
        CREATE TABLE IF NOT EXISTS automationhub_schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS automationhub_entities (
          collection TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          payload JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (collection, entity_id)
        )
      `);
      await client.query(
        `INSERT INTO automationhub_schema_migrations (version)
         VALUES ($1)
         ON CONFLICT (version) DO NOTHING`,
        [MIGRATION_VERSION]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

async function loadStoreData(client: { query: Pool["query"] }): Promise<StoreData> {
  const result = await client.query<EntityRow>(
    "SELECT collection, entity_id, payload FROM automationhub_entities ORDER BY collection, entity_id"
  );
  return hydrateStoreData(toStoredEntityRows(result.rows));
}

function toStoredEntityRows(rows: EntityRow[]): StoredEntityRow[] {
  return rows.map((row) => ({
    collection: row.collection,
    entityId: row.entity_id,
    payload: row.payload
  }));
}
