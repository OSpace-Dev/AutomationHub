import { test } from "node:test";
import assert from "node:assert/strict";
import { PostgresStore } from "../infrastructure/persistence/postgres-store.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

test("PostgresStore persists entity rows and serializes concurrent updates", { skip: !databaseUrl }, async () => {
  const first = new PostgresStore({ connectionString: databaseUrl });
  const second = new PostgresStore({ connectionString: databaseUrl });
  try {
    await first.initialize();
    await first.update((data) => {
      for (const collection of Object.keys(data) as Array<keyof typeof data>) data[collection].length = 0;
    });
    await first.update((data) => {
      for (const collection of Object.keys(data) as Array<keyof typeof data>) {
        data[collection].push({ id: `${collection}-one` } as never);
      }
    });
    const allCollections = await second.read();
    for (const collection of Object.keys(allCollections) as Array<keyof typeof allCollections>) {
      assert.equal(allCollections[collection].length, 1);
    }
    await first.update((data) => {
      for (const collection of Object.keys(data) as Array<keyof typeof data>) data[collection].length = 0;
    });

    await Promise.all([
      first.update((data) => {
        data.devices.push({
          id: "device-one",
          name: "first",
          extensionVersion: "1.0.0",
          registeredAt: "2026-08-18T00:00:00.000Z",
          queueDepth: 0,
          status: "active"
        });
      }),
      second.update((data) => {
        data.devices.push({
          id: "device-two",
          name: "second",
          extensionVersion: "1.0.0",
          registeredAt: "2026-08-18T00:00:01.000Z",
          queueDepth: 0,
          status: "active"
        });
      })
    ]);

    const stored = await first.read();
    assert.deepEqual(stored.devices.map((device) => device.id).sort(), ["device-one", "device-two"]);

    await first.update((data) => {
      data.devices = data.devices.filter((device) => device.id !== "device-one");
    });
    const afterDelete = await second.read();
    assert.deepEqual(afterDelete.devices.map((device) => device.id), ["device-two"]);
  } finally {
    await first.close();
    await second.close();
  }
});
