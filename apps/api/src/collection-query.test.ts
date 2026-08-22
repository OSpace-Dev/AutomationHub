import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_STORE } from "./models.js";
import { StoreBackedCollectionQueryAdapter } from "./infrastructure/persistence/store-backed-collection-query-adapter.js";
import type { Store } from "./store.js";

test("StoreBackedCollectionQueryAdapter reads collection query data without exposing Store mutations", async () => {
  const store: Store = {
    async initialize() {},
    async read() {
      return {
        ...structuredClone(EMPTY_STORE),
        runs: [{ id: "run-one" } as never],
        items: [{ id: "item-one" } as never],
        devices: [{ id: "device-one" } as never],
        tasks: [{ id: "task-one" } as never],
        schedules: [{ id: "schedule-one" } as never]
      };
    },
    async update() {
      throw new Error("not supported");
    },
    async close() {}
  };

  const snapshot = await new StoreBackedCollectionQueryAdapter(store).readSnapshot();

  assert.deepEqual(snapshot.runs.map((run) => run.id), ["run-one"]);
  assert.deepEqual(snapshot.items.map((item) => item.id), ["item-one"]);
  assert.deepEqual(snapshot.devices.map((device) => device.id), ["device-one"]);
  assert.deepEqual(snapshot.tasks.map((task) => task.id), ["task-one"]);
  assert.deepEqual(snapshot.schedules.map((schedule) => schedule.id), ["schedule-one"]);
});
