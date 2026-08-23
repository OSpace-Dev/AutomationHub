import type { Store } from "../../application/ports/store.js";
import type { StoreData } from "../../domain/models.js";
import type { CollectionWritePort } from "../../application/ports/collection-write-port.js";

export class StoreBackedCollectionWriteAdapter implements CollectionWritePort {
  constructor(private readonly store: Store) {}

  update<T>(mutation: (data: StoreData) => T): Promise<T> {
    return this.store.update(mutation);
  }
}
