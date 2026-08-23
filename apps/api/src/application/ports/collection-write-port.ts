import type { StoreData } from "../../domain/models.js";

export interface CollectionWritePort {
  update<T>(mutation: (data: StoreData) => T): Promise<T>;
}
