import { createId, createOpaqueToken } from "./crypto.js";
import { ApiError } from "./errors.js";
import { ModelProviderService } from "./model-service.js";
import type { ReportGeneration, ReportInsights } from "./models.js";
import type { Store } from "./store.js";
import { paginate, type ReportPageResult } from "./application/report-analysis.js";
import { ReportWorker, type ReportWorkerOptions } from "./application/report-worker.js";

export { GitHubTrendingReportSource } from "./application/report-source.js";
export { buildReportInsights, parseModelBatch } from "./application/report-analysis.js";
export { ReportWorker } from "./application/report-worker.js";

export type ReportGenerationServiceOptions = ReportWorkerOptions;

export class ReportGenerationService {
  private readonly worker: ReportWorker;

  constructor(private readonly store: Store, private readonly providers: ModelProviderService, options: ReportGenerationServiceOptions = {}) {
    this.worker = new ReportWorker(store, providers, options);
  }
  async start(): Promise<void> { await this.worker.start(); }
  stop(): void { this.worker.stop(); }
  wake(): void { this.worker.wake(); }
  async enqueueAutomatic(runId?: string): Promise<ReportGeneration | null> {
    if (!runId) return null;
    const setup = await this.providers.getDefault();
    if (!setup) return null;
    const result = await this.store.update((data) => { const run = data.runs.find((entry) => entry.id === runId); if (!run) return null; const existing = data.reportGenerations.find((entry) => entry.definitionId === setup.definition.id && entry.runId === runId && entry.trigger === "automatic"); if (existing) return structuredClone(existing); const generation: ReportGeneration = { id: createId(), definitionId: setup.definition.id, sourceType: setup.definition.sourceType, businessDate: run.businessDate, runId, trigger: "automatic", status: "pending", inputItemCount: 0, attemptCount: 0, shareToken: createOpaqueToken(), createdAt: new Date().toISOString() }; data.reportGenerations.push(generation); return structuredClone(generation); });
    if (result) this.wake();
    return result;
  }
  async createManual(runId: string): Promise<ReportGeneration> { return this.createFromRun(runId, "manual"); }
  async retry(generationId: string): Promise<ReportGeneration> { const data = await this.store.read(); const previous = data.reportGenerations.find((entry) => entry.id === generationId); if (!previous) throw new ApiError(404, "report_not_found", "Report generation was not found"); return this.createFromRun(previous.runId, "retry", previous.id); }
  async list(input: { date?: string; status?: ReportGeneration["status"]; trigger?: ReportGeneration["trigger"]; page?: number; pageSize?: number }): Promise<ReportPageResult<ReportGeneration>> { const data = await this.store.read(); return paginate(data.reportGenerations.filter((entry) => (!input.date || entry.businessDate === input.date) && (!input.status || entry.status === input.status) && (!input.trigger || entry.trigger === input.trigger)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), input.page, input.pageSize); }
  async get(id: string): Promise<ReportGeneration> { const data = await this.store.read(); const generation = data.reportGenerations.find((entry) => entry.id === id); if (!generation) throw new ApiError(404, "report_not_found", "Report generation was not found"); return structuredClone(generation); }
  async getPublic(token: string): Promise<{ businessDate: string; sourceType: string; content: string; insights?: ReportInsights; completedAt?: string }> { const data = await this.store.read(); const generation = data.reportGenerations.find((entry) => entry.shareToken === token && entry.status === "completed" && entry.content); if (!generation || !generation.content) throw new ApiError(404, "public_report_not_found", "Public report was not found"); return { businessDate: generation.businessDate, sourceType: generation.sourceType, content: generation.content, insights: generation.insights, completedAt: generation.completedAt }; }

  private async createFromRun(runId: string, trigger: ReportGeneration["trigger"], parentGenerationId?: string): Promise<ReportGeneration> { const setup = await this.providers.getDefault(); if (!setup) throw new ApiError(409, "default_model_provider_missing", "Configure a default model provider first"); const generation = await this.store.update((data) => { const run = data.runs.find((entry) => entry.id === runId); if (!run) throw new ApiError(404, "report_source_not_found", "Collection run was not found"); const created: ReportGeneration = { id: createId(), definitionId: setup.definition.id, sourceType: setup.definition.sourceType, businessDate: run.businessDate, runId, trigger, status: "pending", inputItemCount: 0, attemptCount: 0, shareToken: createOpaqueToken(), parentGenerationId, createdAt: new Date().toISOString() }; data.reportGenerations.push(created); return structuredClone(created); }); this.wake(); return generation; }
}
export { paginate, type ReportPageResult } from "./application/report-analysis.js";
