import type { CollectionQueryPort, CollectionQuerySnapshot } from "../../application/ports/collection-query-port.js";
import type { Store } from "../../application/ports/store.js";

export class StoreBackedCollectionQueryAdapter implements CollectionQueryPort {
  constructor(private readonly store: Store) {}

  async readSnapshot(): Promise<CollectionQuerySnapshot> {
    const data = await this.store.read();
    return {
      runs: data.runs,
      items: data.items,
      devices: data.devices,
      tasks: data.tasks,
      schedules: data.schedules,
      logs: data.logs
    };
  }
}
