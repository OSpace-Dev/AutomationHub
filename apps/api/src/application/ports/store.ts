import type { StoreData } from "../../domain/models.js";

export interface Store {
  initialize(bootstrapCode?: string): Promise<void>;
  read(): Promise<StoreData>;
  update<T>(mutation: (data: StoreData) => T): Promise<T>;
  close(): Promise<void>;
}
