import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { SqliteStore } from "./sqlite-store.js";

test("SqliteStore persists data across restart and supports update/delete", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "automation-hub-sqlite-"));
  const databasePath = join(temporaryDirectory, "automationhub.sqlite");
  const first = new SqliteStore(databasePath);
  const second = new SqliteStore(databasePath);

  try {
    await first.initialize("bootstrap-code");
    await first.update((data) => {
      data.devices.push({
        id: "device-one",
        name: "local-node",
        extensionVersion: "1.0.0",
        registeredAt: "2026-08-18T00:00:00.000Z",
        queueDepth: 0,
        status: "active"
      });
      data.tasks.push({
        id: "task-one",
        deviceId: "device-one",
        type: "capture_trending",
        status: "pending",
        businessDate: "2026-08-18",
        idempotencyKey: "task-one",
        createdAt: "2026-08-18T00:00:00.000Z"
      });
    });

    const stored = await first.read();
    assert.equal(stored.registrationCodes.length, 1);
    assert.equal(stored.devices[0]?.id, "device-one");
    assert.equal(stored.tasks[0]?.id, "task-one");

    await first.close();
    await second.initialize("bootstrap-code");
    const reopened = await second.read();
    assert.deepEqual(reopened.devices, stored.devices);
    assert.deepEqual(reopened.tasks, stored.tasks);
    assert.deepEqual(reopened.registrationCodes, stored.registrationCodes);
    assert.equal(reopened.registrationCodes.length, 1);

    await second.update((data) => {
      data.devices[0]!.name = "renamed-local-node";
      data.tasks = [];
    });
    const afterUpdate = await second.read();
    assert.equal(afterUpdate.devices[0]?.name, "renamed-local-node");
    assert.deepEqual(afterUpdate.tasks, []);

    await second.update((data) => {
      data.devices = [];
    });
    const afterDelete = await second.read();
    assert.deepEqual(afterDelete.devices, []);
  } finally {
    await first.close();
    await second.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
