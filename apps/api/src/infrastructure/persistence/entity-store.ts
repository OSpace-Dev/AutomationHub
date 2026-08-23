import { EMPTY_STORE, type StoreData } from "../../domain/models.js";

export const STORE_COLLECTIONS = [
  "registrationCodes",
  "devices",
  "tokens",
  "runs",
  "items",
  "tasks",
  "schedules",
  "logs",
  "modelProviders",
  "reportDefinitions",
  "reportGenerations",
  "notificationChannels",
  "notificationTargets",
  "reportDeliveries"
] as const satisfies readonly (keyof StoreData)[];

export type StoreCollection = (typeof STORE_COLLECTIONS)[number];

export interface StoredEntityRow {
  collection: string;
  entityId: string;
  payload: unknown;
}

export function hydrateStoreData(rows: StoredEntityRow[]): StoreData {
  const data = structuredClone(EMPTY_STORE);
  for (const row of rows) {
    if (!STORE_COLLECTIONS.includes(row.collection as StoreCollection)) {
      throw new Error(`Unknown store collection: ${row.collection}`);
    }
    const collection = row.collection as StoreCollection;
    const entity = row.payload as { id?: unknown };
    if (entity === null || typeof entity !== "object" || entity.id !== row.entityId) {
      throw new Error(`Invalid store entity: ${row.collection}/${row.entityId}`);
    }
    data[collection].push(entity as never);
  }
  return data;
}

export function snapshotEntities(data: StoreData): Record<StoreCollection, Record<string, string>> {
  return Object.fromEntries(
    STORE_COLLECTIONS.map((collection) => [
      collection,
      Object.fromEntries(data[collection].map((entity) => [entity.id, JSON.stringify(entity)]))
    ])
  ) as Record<StoreCollection, Record<string, string>>;
}
