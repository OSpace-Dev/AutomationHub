import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_STORE } from "../domain/models.js";
import { StoreBackedNotificationPersistenceAdapter } from "../infrastructure/persistence/store-backed-notification-persistence-adapter.js";
import { StoreBackedReportPersistenceAdapter } from "../infrastructure/persistence/store-backed-report-persistence-adapter.js";
import type { Store } from "../application/ports/store.js";

function createStore(): Store & { updateCount: number } {
  let updateCount = 0;
  const store: Store & { updateCount: number } = {
    updateCount,
    async initialize() {},
    async read() {
      return structuredClone(EMPTY_STORE);
    },
    async update(mutation) {
      updateCount += 1;
      store.updateCount = updateCount;
      const data = structuredClone(EMPTY_STORE);
      return mutation(data);
    },
    async close() {}
  };
  return store;
}

test("StoreBackedReportPersistenceAdapter exposes only report collections", async () => {
  const store = createStore();
  const adapter = new StoreBackedReportPersistenceAdapter(store);

  const snapshot = await adapter.readSnapshot();
  assert.deepEqual(Object.keys(snapshot).sort(), [
    "items",
    "modelProviders",
    "reportDefinitions",
    "reportGenerations",
    "runs"
  ]);

  const result = await adapter.update((data) => {
    data.reportGenerations.push({
      id: "report-one",
      definitionId: "definition-one",
      sourceType: "github_trending",
      businessDate: "2026-08-23",
      runId: "run-one",
      trigger: "manual",
      status: "pending",
      inputItemCount: 0,
      attemptCount: 0,
      createdAt: "2026-08-23T00:00:00.000Z"
    });
    return Object.keys(data).sort();
  });

  assert.deepEqual(result, [
    "items",
    "modelProviders",
    "reportDefinitions",
    "reportGenerations",
    "runs"
  ]);
  assert.equal(store.updateCount, 1);
});

test("StoreBackedNotificationPersistenceAdapter preserves one transaction for delivery mutations", async () => {
  const store = createStore();
  const adapter = new StoreBackedNotificationPersistenceAdapter(store);

  const result = await adapter.update((data) => {
    data.reportDeliveries.push({
      id: "delivery-one",
      reportGenerationId: "report-one",
      channelId: "channel-one",
      targetId: "target-one",
      status: "pending",
      attemptCount: 0,
      createdAt: "2026-08-23T00:00:00.000Z"
    });
    return Object.keys(data).sort();
  });

  assert.deepEqual(result, [
    "notificationChannels",
    "notificationTargets",
    "reportDeliveries",
    "reportGenerations"
  ]);
  assert.equal(store.updateCount, 1);
});
