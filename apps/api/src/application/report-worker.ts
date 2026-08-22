import { createOpaqueToken } from "../crypto.js";
import { ApiError } from "../errors.js";
import { ModelProviderService } from "../model-service.js";
import type { ReportGeneration } from "../models.js";
import type { Store } from "../store.js";
import { buildReportInsights, findIncompleteProjectUrl, mergeModelAnalyses, parseModelBatch, type ModelProjectAnalysis } from "./report-analysis.js";
import { findPreviousRun, GitHubTrendingReportSource, type PreparedReportBatch } from "./report-source.js";

const MODEL_BATCH_MAX_ATTEMPTS = 2;
const DEFAULT_MODEL_REQUEST_MIN_INTERVAL_MS = 60_000;
const MAX_MODEL_REQUEST_MIN_INTERVAL_MS = 2_147_483_647;

export interface ReportWorkerOptions {
  modelRequestMinIntervalMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  onCompletedReport?: (generationId: string) => void | Promise<void>;
}

class ModelRequestPacer {
  private nextAllowedAt = 0;
  private queue = Promise.resolve();

  constructor(private readonly minIntervalMs: number, private readonly now: () => number, private readonly sleep: (milliseconds: number) => Promise<void>) {}

  async waitForTurn(): Promise<void> {
    const turn = this.queue.then(async () => {
      const delay = Math.max(0, this.nextAllowedAt - this.now());
      if (delay > 0) await this.sleep(delay);
      this.nextAllowedAt = this.now() + this.minIntervalMs;
    });
    this.queue = turn.catch(() => undefined);
    await turn;
  }
}

function sleep(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

export class ReportWorker {
  private processing = false;
  private stopped = false;
  private wakeTimer: NodeJS.Timeout | undefined;
  private readonly source = new GitHubTrendingReportSource();
  private readonly modelRequestPacer: ModelRequestPacer;
  private readonly onCompletedReport: ReportWorkerOptions["onCompletedReport"];

  constructor(private readonly store: Store, private readonly providers: ModelProviderService, options: ReportWorkerOptions = {}) {
    this.modelRequestPacer = new ModelRequestPacer(normalizeModelRequestMinInterval(options.modelRequestMinIntervalMs), options.now ?? Date.now, options.sleep ?? sleep);
    this.onCompletedReport = options.onCompletedReport;
  }

  async start(): Promise<void> { await this.ensureShareTokens(); await this.recoverInterrupted(); this.wake(); }

  stop(): void { this.stopped = true; if (this.wakeTimer) clearTimeout(this.wakeTimer); }

  wake(): void { if (this.stopped || this.wakeTimer) return; this.wakeTimer = setTimeout(() => { this.wakeTimer = undefined; void this.processLoop(); }, 0); this.wakeTimer.unref?.(); }

  private async processLoop(): Promise<void> {
    if (this.processing || this.stopped) return;
    this.processing = true;
    try {
      while (!this.stopped) {
        const generation = await this.claimNext();
        if (!generation) break;
        await this.processOne(generation);
      }
    } finally {
      this.processing = false;
    }
  }

  private async claimNext(): Promise<ReportGeneration | null> {
    const snapshot = await this.store.read();
    if (!snapshot.reportGenerations.some((entry) => entry.status === "pending")) return null;
    return this.store.update((data) => {
      const generation = data.reportGenerations.filter((entry) => entry.status === "pending").sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (!generation) return null;
      generation.status = "running";
      generation.startedAt = new Date().toISOString();
      generation.attemptCount += 1;
      return structuredClone(generation);
    });
  }

  private async processOne(generation: ReportGeneration): Promise<void> {
    try {
      const data = await this.store.read();
      const current = data.reportGenerations.find((entry) => entry.id === generation.id);
      const definition = current && data.reportDefinitions.find((entry) => entry.id === current.definitionId);
      const provider = definition?.providerId && data.modelProviders.find((entry) => entry.id === definition.providerId);
      const run = current && data.runs.find((entry) => entry.id === current.runId);
      const items = current ? data.items.filter((entry) => entry.runId === current.runId) : [];
      const previousRun = run ? findPreviousRun(data, run) : undefined;
      const previousItems = previousRun ? data.items.filter((entry) => entry.runId === previousRun.id) : [];
      if (!current || !definition || !provider || !run) throw new ApiError(409, "default_model_provider_missing", "Report configuration or source is unavailable");
      const batches = this.source.prepareBatches({ run, items, previousRun, previousItems }, definition);
      const inputItemCount = batches.reduce((sum, batch) => sum + batch.itemCount, 0);
      await this.store.update((next) => {
        const target = next.reportGenerations.find((entry) => entry.id === generation.id);
        if (!target) return;
        target.providerName = provider.name;
        target.model = provider.selectedModel;
        target.inputItemCount = inputItemCount;
      });
      const apiKey = this.providers.decryptApiKey(provider);
      const analyses = new Map<string, ModelProjectAnalysis>();
      for (const batch of batches) {
        const batchAnalyses = await this.generateBatchAnalyses(provider.baseUrl, apiKey, provider.selectedModel, batch);
        for (const [projectUrl, analysis] of batchAnalyses) analyses.set(projectUrl, analysis);
      }
      const insights = buildReportInsights(items, previousRun, previousItems, analyses);
      await this.store.update((next) => {
        const target = next.reportGenerations.find((entry) => entry.id === generation.id);
        if (!target) return;
        target.status = "completed";
        target.content = insights.overview;
        target.insights = insights;
        target.completedAt = new Date().toISOString();
        target.errorCode = undefined;
        target.errorMessage = undefined;
      });
      void this.onCompletedReport?.(generation.id);
    } catch (error) {
      const safe = error instanceof ApiError ? error : new ApiError(502, "report_generation_failed", "Report generation failed", true);
      await this.store.update((data) => {
        const target = data.reportGenerations.find((entry) => entry.id === generation.id);
        if (!target) return;
        target.status = "failed";
        target.errorCode = safe.code;
        target.errorMessage = safe.message.slice(0, 240);
        target.completedAt = new Date().toISOString();
      });
    }
  }

  private async generateBatchAnalyses(baseUrl: string, apiKey: string, model: string, batch: PreparedReportBatch): Promise<Map<string, ModelProjectAnalysis>> {
    if (!batch.requiredProjectUrls.length) return new Map();
    let lastError: unknown;
    let receivedStructuredResponse = false;
    const mergedAnalyses = new Map<string, ModelProjectAnalysis>();
    for (let attempt = 1; attempt <= MODEL_BATCH_MAX_ATTEMPTS; attempt += 1) {
      try {
        await this.modelRequestPacer.waitForTurn();
        const modelResponse = await this.providers.clientInstance.createChatCompletion(baseUrl, apiKey, model, batch.messages);
        const parsed = parseModelBatch(modelResponse, batch.requiredProjectUrls);
        if (!parsed.isStructured) throw new ApiError(502, "report_generation_failed", "Model service returned invalid project analysis structure", true);
        receivedStructuredResponse = true;
        mergeModelAnalyses(mergedAnalyses, parsed.analyses);
        const missingProject = findIncompleteProjectUrl(batch.requiredProjectUrls, mergedAnalyses);
        if (!missingProject) return mergedAnalyses;
        lastError = new ApiError(502, "report_generation_failed", "Model service returned incomplete project analyses", true);
      } catch (error) {
        lastError = error;
      }
    }
    if (receivedStructuredResponse) return mergedAnalyses;
    throw lastError instanceof Error ? lastError : new ApiError(502, "report_generation_failed", "Model project analysis failed", true);
  }

  private async recoverInterrupted(): Promise<void> {
    const snapshot = await this.store.read();
    if (!snapshot.reportGenerations.some((generation) => generation.status === "running")) return;
    await this.store.update((data) => {
      for (const generation of data.reportGenerations) if (generation.status === "running") {
        generation.status = "pending";
        generation.startedAt = undefined;
      }
    });
  }

  private async ensureShareTokens(): Promise<void> {
    const snapshot = await this.store.read();
    if (!snapshot.reportGenerations.some((generation) => !generation.shareToken)) return;
    await this.store.update((data) => {
      for (const generation of data.reportGenerations) if (!generation.shareToken) generation.shareToken = createOpaqueToken();
    });
  }
}

function normalizeModelRequestMinInterval(value: number | undefined): number { if (!Number.isSafeInteger(value) || value === undefined || value < 0) return DEFAULT_MODEL_REQUEST_MIN_INTERVAL_MS; return Math.min(value, MAX_MODEL_REQUEST_MIN_INTERVAL_MS); }
