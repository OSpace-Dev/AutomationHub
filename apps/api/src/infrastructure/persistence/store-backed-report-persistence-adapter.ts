import type {
  ReportPersistenceData,
  ReportPersistencePort
} from "../../application/ports/report-persistence-port.js";
import type { Store } from "../../application/ports/store.js";
import type { StoreData } from "../../domain/models.js";

export class StoreBackedReportPersistenceAdapter implements ReportPersistencePort {
  constructor(private readonly store: Store) {}

  async readSnapshot(): Promise<ReportPersistenceData> {
    const data = await this.store.read();
    return selectReportData(data);
  }

  update<T>(mutation: (data: ReportPersistenceData) => T): Promise<T> {
    return this.store.update((data) => mutation(selectReportData(data)));
  }
}

function selectReportData(data: StoreData): ReportPersistenceData {
  return {
    runs: data.runs,
    items: data.items,
    modelProviders: data.modelProviders,
    reportDefinitions: data.reportDefinitions,
    reportGenerations: data.reportGenerations
  };
}
