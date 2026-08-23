import type { StoreData } from "../../domain/models.js";

export type ReportPersistenceData = Pick<
  StoreData,
  "runs" | "items" | "modelProviders" | "reportDefinitions" | "reportGenerations"
>;

export interface ReportPersistencePort {
  readSnapshot(): Promise<ReportPersistenceData>;
  update<T>(mutation: (data: ReportPersistenceData) => T): Promise<T>;
}

export type ReportRunData = Pick<ReportPersistenceData, "runs" | "items">;
