import { createId, createOpaqueToken } from "./crypto.js";
import { ApiError } from "./errors.js";
import { ModelProviderService } from "./model-service.js";
import type { CollectionRun, ProjectSnapshot, ReportDefinition, ReportGeneration, ReportInsights, ReportProjectInsight, ReportTrendProject, StoreData } from "./models.js";
import type { Store } from "./store.js";

const MAX_README_CHARS = 1_500;
const MAX_BATCH_INPUT_CHARS = 18_000;
const PROJECT_BATCH_SIZE = 4;
const MODEL_BATCH_MAX_ATTEMPTS = 2;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PROJECT_PURPOSE_CHARS = 45;
const MAX_PROJECT_ATTENTION_CHARS = 55;
const DEFAULT_MODEL_REQUEST_MIN_INTERVAL_MS = 60_000;
const MAX_MODEL_REQUEST_MIN_INTERVAL_MS = 2_147_483_647;

interface ReportSourceInput {
  run: CollectionRun;
  items: ProjectSnapshot[];
  previousRun?: CollectionRun;
  previousItems: ProjectSnapshot[];
}

interface PreparedReportBatch {
  itemCount: number;
  projectUrls: string[];
  requiredProjectUrls: string[];
  messages: Array<{ role: "system" | "user"; content: string }>;
}

interface ModelProjectAnalysis {
  category: string;
  purpose?: string;
  attentionReason?: string;
}

interface ParsedModelBatch {
  analyses: Map<string, ModelProjectAnalysis>;
  isStructured: boolean;
}

const REPORT_CATEGORIES = [
  { key: "ai-agents", label: "AI Agent / 智能体" },
  { key: "llm-training-inference", label: "大模型与训练推理" },
  { key: "data-search-rag", label: "数据、搜索与 RAG" },
  { key: "developer-tools", label: "开发者工具" },
  { key: "web-app-frameworks", label: "Web 与应用框架" },
  { key: "infrastructure-operations", label: "基础设施与运维" },
  { key: "security-osint", label: "安全与 OSINT" },
  { key: "media-design", label: "多媒体与设计创作" },
  { key: "other", label: "其他" }
] as const;

const CATEGORY_RESPONSE_INSTRUCTION = `你正在分析日报中的一小批项目。必须只返回一个 JSON 对象，不要使用 Markdown 代码围栏。格式如下：
{"project_analyses":[{"project_url":"输入中的完整项目地址","category":"预设分类名称","purpose":"一句话说明项目做什么","attention_reason":"一句话说明为什么值得关注"}]}
每个项目必须且只能出现一次。category 只能从以下名称中选择：${REPORT_CATEGORIES.map((category) => category.label).join("、")}。
purpose 和 attention_reason 会在日报中合并成一段项目摘要，两项合并后约 50 至 100 个中文字符。purpose 建议 25 至 45 个中文字符，说明项目定位、核心能力和解决的问题；attention_reason 建议 25 至 55 个中文字符，说明适用场景、实际价值或独特之处，让读者理解为什么值得关注。
两项必须基于项目描述或 README，避免“非常强大”“值得一看”等空泛表达；内容不要重复，不要使用标题、列表或“用途”“值得关注”等标签。
attention_reason 不要复述排名、语言、总 Star、今日新增或排名变化，这些数据由系统单独展示。
资料不足时不要猜测：category 使用“其他”，purpose 写“暂无可靠项目说明”，attention_reason 写“采集内容不足，建议重新采集后分析”。`;

export class GitHubTrendingReportSource {
  prepareBatches(input: ReportSourceInput, definition: ReportDefinition): PreparedReportBatch[] {
    const ranked = input.items.slice().sort((a, b) => a.rank - b.rank);
    if (!ranked.length) throw new ApiError(422, "report_source_empty", "Collection run has no projects");
    const batches: PreparedReportBatch[] = [];
    let projectBlocks: string[] = [];
    let projectUrls: string[] = [];
    let requiredProjectUrls: string[] = [];
    let used = 0;
    const flush = () => {
      if (!projectBlocks.length) return;
      batches.push({
        itemCount: projectBlocks.length,
        projectUrls,
        requiredProjectUrls,
        messages: [
          { role: "system", content: definition.promptTemplate },
          { role: "system", content: CATEGORY_RESPONSE_INSTRUCTION },
          { role: "user", content: `业务日期：${input.run.businessDate}\n来源：${input.run.sourceUrl}\n本批项目资料：\n\n${projectBlocks.join("\n\n---\n\n")}` }
        ]
      });
      projectBlocks = [];
      projectUrls = [];
      requiredProjectUrls = [];
      used = 0;
    };
    for (const item of ranked) {
      const description = cleanSourceText(item.description);
      const readmeSource = item.status === "success" ? item.readmeText || stripHtml(item.readmeHtml) : "";
      const readme = cleanSourceText(readmeSource)?.slice(0, MAX_README_CHARS);
      const block = [
        `项目：${item.name}`,
        `地址：${item.projectUrl}`,
        description ? `描述：${description}` : "",
        item.language ? `语言：${item.language}` : "",
        `状态：${item.status}`,
        item.errorCode ? `错误：${item.errorCode}` : "",
        readme ? `README：\n${readme}` : ""
      ].filter(Boolean).join("\n");
      if (projectBlocks.length > 0 && (projectBlocks.length >= PROJECT_BATCH_SIZE || used + block.length > MAX_BATCH_INPUT_CHARS)) flush();
      projectBlocks.push(block);
      projectUrls.push(item.projectUrl);
      if (hasUsableProjectContent(item)) requiredProjectUrls.push(item.projectUrl);
      used += block.length;
    }
    flush();
    if (!batches.length) throw new ApiError(422, "report_source_empty", "Collection run has no usable project data");
    return batches;
  }
}

export interface ReportPageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ReportGenerationServiceOptions {
  modelRequestMinIntervalMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

class ModelRequestPacer {
  private nextAllowedAt = 0;
  private queue = Promise.resolve();

  constructor(
    private readonly minIntervalMs: number,
    private readonly now: () => number,
    private readonly sleep: (milliseconds: number) => Promise<void>
  ) {}

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

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class ReportGenerationService {
  private processing = false;
  private stopped = false;
  private wakeTimer: NodeJS.Timeout | undefined;
  private readonly source = new GitHubTrendingReportSource();
  private readonly modelRequestPacer: ModelRequestPacer;

  constructor(
    private readonly store: Store,
    private readonly providers: ModelProviderService,
    options: ReportGenerationServiceOptions = {}
  ) {
    this.modelRequestPacer = new ModelRequestPacer(
      normalizeModelRequestMinInterval(options.modelRequestMinIntervalMs),
      options.now ?? Date.now,
      options.sleep ?? sleep
    );
  }

  async start(): Promise<void> {
    await this.ensureShareTokens();
    await this.recoverInterrupted();
    this.wake();
  }

  stop(): void {
    this.stopped = true;
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
  }

  wake(): void {
    if (this.stopped || this.wakeTimer) return;
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = undefined;
      void this.processLoop();
    }, 0);
    this.wakeTimer.unref?.();
  }

  async enqueueAutomatic(runId?: string): Promise<ReportGeneration | null> {
    if (!runId) return null;
    const setup = await this.providers.getDefault();
    if (!setup) return null;
    const result = await this.store.update((data) => {
      const run = data.runs.find((entry) => entry.id === runId);
      if (!run) return null;
      const existing = data.reportGenerations.find((entry) => entry.definitionId === setup.definition.id && entry.runId === runId && entry.trigger === "automatic");
      if (existing) return structuredClone(existing);
      const generation: ReportGeneration = {
        id: createId(),
        definitionId: setup.definition.id,
        sourceType: setup.definition.sourceType,
        businessDate: run.businessDate,
        runId,
        trigger: "automatic",
        status: "pending",
        inputItemCount: 0,
        attemptCount: 0,
        shareToken: createOpaqueToken(),
        createdAt: new Date().toISOString()
      };
      data.reportGenerations.push(generation);
      return structuredClone(generation);
    });
    if (result) this.wake();
    return result;
  }

  async createManual(runId: string): Promise<ReportGeneration> {
    return this.createFromRun(runId, "manual");
  }

  async retry(generationId: string): Promise<ReportGeneration> {
    const data = await this.store.read();
    const previous = data.reportGenerations.find((entry) => entry.id === generationId);
    if (!previous) throw new ApiError(404, "report_not_found", "Report generation was not found");
    return this.createFromRun(previous.runId, "retry", previous.id);
  }

  async list(input: { date?: string; status?: ReportGeneration["status"]; page?: number; pageSize?: number }): Promise<ReportPageResult<ReportGeneration>> {
    const data = await this.store.read();
    return paginate(data.reportGenerations
      .filter((entry) => (!input.date || entry.businessDate === input.date) && (!input.status || entry.status === input.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)), input.page, input.pageSize);
  }

  async get(id: string): Promise<ReportGeneration> {
    const data = await this.store.read();
    const generation = data.reportGenerations.find((entry) => entry.id === id);
    if (!generation) throw new ApiError(404, "report_not_found", "Report generation was not found");
    return structuredClone(generation);
  }

  async getPublic(token: string): Promise<{ businessDate: string; sourceType: string; content: string; insights?: ReportInsights; completedAt?: string }> {
    const data = await this.store.read();
    const generation = data.reportGenerations.find((entry) => entry.shareToken === token && entry.status === "completed" && entry.content);
    if (!generation || !generation.content) throw new ApiError(404, "public_report_not_found", "Public report was not found");
    return {
      businessDate: generation.businessDate,
      sourceType: generation.sourceType,
      content: generation.content,
      insights: generation.insights,
      completedAt: generation.completedAt
    };
  }

  private async createFromRun(runId: string, trigger: ReportGeneration["trigger"], parentGenerationId?: string): Promise<ReportGeneration> {
    const setup = await this.providers.getDefault();
    if (!setup) throw new ApiError(409, "default_model_provider_missing", "Configure a default model provider first");
    const generation = await this.store.update((data) => {
      const run = data.runs.find((entry) => entry.id === runId);
      if (!run) throw new ApiError(404, "report_source_not_found", "Collection run was not found");
      const created: ReportGeneration = {
        id: createId(),
        definitionId: setup.definition.id,
        sourceType: setup.definition.sourceType,
        businessDate: run.businessDate,
        runId,
        trigger,
        status: "pending",
        inputItemCount: 0,
        attemptCount: 0,
        shareToken: createOpaqueToken(),
        parentGenerationId,
        createdAt: new Date().toISOString()
      };
      data.reportGenerations.push(created);
      return structuredClone(created);
    });
    this.wake();
    return generation;
  }

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
      const generation = data.reportGenerations
        .filter((entry) => entry.status === "pending")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
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

  private async generateBatchAnalyses(
    baseUrl: string,
    apiKey: string,
    model: string,
    batch: PreparedReportBatch
  ): Promise<Map<string, ModelProjectAnalysis>> {
    if (!batch.requiredProjectUrls.length) return new Map();
    let lastError: unknown;
    let receivedStructuredResponse = false;
    const mergedAnalyses = new Map<string, ModelProjectAnalysis>();
    for (let attempt = 1; attempt <= MODEL_BATCH_MAX_ATTEMPTS; attempt += 1) {
      try {
        await this.modelRequestPacer.waitForTurn();
        const modelResponse = await this.providers.clientInstance.createChatCompletion(baseUrl, apiKey, model, batch.messages);
        const parsed = parseModelBatch(modelResponse, batch.requiredProjectUrls);
        if (!parsed.isStructured) {
          throw new ApiError(502, "report_generation_failed", "Model service returned invalid project analysis structure", true);
        }
        receivedStructuredResponse = true;
        for (const [projectUrl, analysis] of parsed.analyses) {
          const previous = mergedAnalyses.get(projectUrl);
          mergedAnalyses.set(projectUrl, {
            category: analysis.category || previous?.category || "其他",
            purpose: analysis.purpose ?? previous?.purpose,
            attentionReason: analysis.attentionReason ?? previous?.attentionReason
          });
        }
        const missingProject = batch.requiredProjectUrls.find(
          (projectUrl) => !isCompleteModelAnalysis(mergedAnalyses.get(normalizeComparableUrl(projectUrl)))
        );
        if (!missingProject) return mergedAnalyses;
        lastError = new ApiError(502, "report_generation_failed", "Model service returned incomplete project analyses", true);
      } catch (error) {
        lastError = error;
      }
    }
    if (receivedStructuredResponse) return mergedAnalyses;
    throw lastError instanceof Error
      ? lastError
      : new ApiError(502, "report_generation_failed", "Model project analysis failed", true);
  }

  private async recoverInterrupted(): Promise<void> {
    await this.store.update((data) => {
      for (const generation of data.reportGenerations) {
        if (generation.status === "running") {
          generation.status = "pending";
          generation.startedAt = undefined;
        }
      }
    });
  }

  private async ensureShareTokens(): Promise<void> {
    const snapshot = await this.store.read();
    if (!snapshot.reportGenerations.some((generation) => !generation.shareToken)) return;
    await this.store.update((data) => {
      for (const generation of data.reportGenerations) {
        if (!generation.shareToken) generation.shareToken = createOpaqueToken();
      }
    });
  }
}

function normalizeModelRequestMinInterval(value: number | undefined): number {
  if (!Number.isSafeInteger(value) || value === undefined || value < 0) {
    return DEFAULT_MODEL_REQUEST_MIN_INTERVAL_MS;
  }
  return Math.min(value, MAX_MODEL_REQUEST_MIN_INTERVAL_MS);
}

function paginate<T>(values: T[], requestedPage = 1, requestedPageSize = DEFAULT_PAGE_SIZE): ReportPageResult<T> {
  const pageSize = Math.min(Math.max(Number.isFinite(requestedPageSize) ? Math.trunc(requestedPageSize) : DEFAULT_PAGE_SIZE, 1), 100);
  const total = values.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1, 1), totalPages);
  return { items: values.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize, totalPages };
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function findPreviousRun(data: StoreData, currentRun: CollectionRun): CollectionRun | undefined {
  const runIdsWithItems = new Set(data.items.map((item) => item.runId));
  return data.runs
    .filter((run) => run.id !== currentRun.id
      && run.businessDate < currentRun.businessDate
      && run.sourceUrl.includes("github.com/trending")
      && runIdsWithItems.has(run.id))
    .sort((a, b) => b.businessDate.localeCompare(a.businessDate) || b.createdAt.localeCompare(a.createdAt))[0];
}

function parseModelBatch(value: string, expectedProjectUrls: string[]): ParsedModelBatch {
  const analyses = new Map<string, ModelProjectAnalysis>();
  const expected = new Set(expectedProjectUrls.map(normalizeComparableUrl));
  const candidate = extractJsonObject(value);
  if (!candidate) return { analyses, isStructured: false };
  try {
    const parsed = JSON.parse(candidate) as { project_analyses?: unknown; project_categories?: unknown };
    const entries = Array.isArray(parsed.project_analyses)
      ? parsed.project_analyses
      : Array.isArray(parsed.project_categories)
        ? parsed.project_categories
        : null;
    if (!entries) return { analyses, isStructured: false };
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const fields = entry as {
        project_url?: unknown;
        url?: unknown;
        repository?: unknown;
        project?: unknown;
        category?: unknown;
        purpose?: unknown;
        attention_reason?: unknown;
        attentionReason?: unknown;
      };
      const projectReference = [fields.project_url, fields.url, fields.repository, fields.project]
        .find((field): field is string => typeof field === "string" && Boolean(field.trim()));
      const category = normalizeCategory(fields.category);
      if (!projectReference || !category) continue;
      const normalizedProjectUrl = normalizeComparableUrl(projectReference);
      if (!expected.has(normalizedProjectUrl)) continue;
      analyses.set(normalizedProjectUrl, {
        category,
        purpose: normalizeModelText(fields.purpose, MAX_PROJECT_PURPOSE_CHARS),
        attentionReason: normalizeModelText(fields.attention_reason ?? fields.attentionReason, MAX_PROJECT_ATTENTION_CHARS)
      });
    }
    return { analyses, isStructured: true };
  } catch {
    return { analyses, isStructured: false };
  }
}

function extractJsonObject(value: string): string | null {
  const trimmed = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : null;
}

function isCompleteModelAnalysis(value: ModelProjectAnalysis | undefined): boolean {
  return Boolean(value?.category && value.purpose && value.attentionReason);
}

function buildReportInsights(
  currentItems: ProjectSnapshot[],
  previousRun: CollectionRun | undefined,
  previousItems: ProjectSnapshot[],
  modelAnalyses: Map<string, ModelProjectAnalysis>
): ReportInsights {
  const ranked = currentItems.slice().sort((a, b) => a.rank - b.rank);
  const previousByUrl = new Map(previousItems.map((item) => [normalizeComparableUrl(item.normalizedProjectUrl), item]));
  const currentUrls = new Set(ranked.map((item) => normalizeComparableUrl(item.normalizedProjectUrl)));
  let analysisFallbackCount = 0;
  const projects: ReportProjectInsight[] = ranked.map((item) => {
    const previous = previousByUrl.get(normalizeComparableUrl(item.normalizedProjectUrl));
    const analysis = modelAnalyses.get(normalizeComparableUrl(item.projectUrl));
    const hasUsableContent = hasUsableProjectContent(item);
    if (hasUsableContent && (!analysis?.category || !analysis.purpose || !analysis.attentionReason)) {
      analysisFallbackCount += 1;
    }
    const category = hasUsableContent ? analysis?.category ?? classifyProject(item) : "其他";
    return {
      projectUrl: item.projectUrl,
      name: item.name,
      rank: item.rank,
      category,
      purpose: hasUsableContent ? analysis?.purpose ?? buildProjectPurpose(item) : "暂无可靠项目说明。",
      attentionReason: hasUsableContent
        ? analysis?.attentionReason ?? buildAttentionReason()
        : "采集内容不足，当前仅保留榜单数据，建议重新采集后分析。",
      description: cleanSourceText(item.description),
      language: item.language,
      totalStars: item.totalStars,
      starsToday: item.starsToday,
      totalStarsDelta: item.totalStars !== undefined && previous?.totalStars !== undefined ? item.totalStars - previous.totalStars : undefined
    };
  });

  const categories = REPORT_CATEGORIES.map((category) => {
    const categoryProjects = projects.filter((project) => project.category === category.label);
    return {
      key: category.key,
      label: category.label,
      projectCount: categoryProjects.length,
      totalStars: sumKnown(categoryProjects.map((project) => project.totalStars)),
      starsToday: sumKnown(categoryProjects.map((project) => project.starsToday)),
      projects: categoryProjects
    };
  }).filter((category) => category.projectCount > 0);

  const continuedEntries: ReportTrendProject[] = [];
  const newEntries: ReportTrendProject[] = [];
  for (const project of projects) {
    const previous = previousByUrl.get(normalizeComparableUrl(project.projectUrl));
    if (!previous) {
      newEntries.push(toTrendProject(project));
      continue;
    }
    continuedEntries.push({
      ...toTrendProject(project),
      previousRank: previous.rank,
      rankChange: previous.rank - project.rank
    });
  }
  const exitedEntries = previousItems
    .filter((item) => !currentUrls.has(normalizeComparableUrl(item.normalizedProjectUrl)))
    .sort((a, b) => a.rank - b.rank)
    .map((item) => ({ projectUrl: item.projectUrl, name: item.name, previousRank: item.rank }));

  const comparableDeltas = projects
    .map((project) => project.totalStarsDelta)
    .filter((value): value is number => value !== undefined);
  return {
    presentationVersion: 2,
    overview: buildFallbackOverview(projects, categories, previousRun, newEntries, exitedEntries),
    metrics: {
      projectCount: projects.length,
      totalStars: sumKnown(projects.map((project) => project.totalStars)),
      starsToday: sumKnown(projects.map((project) => project.starsToday)),
      categoryCount: categories.length,
      totalStarsDelta: previousRun && comparableDeltas.length ? comparableDeltas.reduce((sum, value) => sum + value, 0) : undefined,
      knownTotalStarsCount: projects.filter((project) => project.totalStars !== undefined).length,
      knownStarsTodayCount: projects.filter((project) => project.starsToday !== undefined).length,
      comparableProjectCount: comparableDeltas.length,
      analysisFallbackCount
    },
    categories,
    trends: {
      hasComparison: Boolean(previousRun),
      comparisonDate: previousRun?.businessDate,
      newEntries: previousRun ? newEntries : [],
      continuedEntries: previousRun ? continuedEntries : [],
      exitedEntries: previousRun ? exitedEntries : [],
      risingEntries: previousRun ? continuedEntries.filter((project) => (project.rankChange ?? 0) > 0) : [],
      fallingEntries: previousRun ? continuedEntries.filter((project) => (project.rankChange ?? 0) < 0) : [],
      unchangedEntries: previousRun ? continuedEntries.filter((project) => project.rankChange === 0) : []
    }
  };
}

function toTrendProject(project: ReportProjectInsight): ReportTrendProject {
  return {
    projectUrl: project.projectUrl,
    name: project.name,
    currentRank: project.rank,
    totalStarsDelta: project.totalStarsDelta
  };
}

function sumKnown(values: Array<number | undefined>): number | undefined {
  const known = values.filter((value): value is number => value !== undefined);
  return known.length ? known.reduce((sum, value) => sum + value, 0) : undefined;
}

function normalizeModelText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized && !isUnusableSourceText(normalized) ? normalized.slice(0, maxLength) : undefined;
}

function buildProjectPurpose(item: ProjectSnapshot): string {
  const description = cleanSourceText(item.description);
  if (description) return description.slice(0, MAX_PROJECT_PURPOSE_CHARS);
  const readmeSource = item.status === "success" ? item.readmeText || stripHtml(item.readmeHtml) : "";
  const readme = cleanSourceText(readmeSource
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[`*_>|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim());
  if (readme) return readme.slice(0, MAX_PROJECT_PURPOSE_CHARS);
  return "暂无可靠项目说明。";
}

function buildAttentionReason(): string {
  return "自动分析未完整返回，已保留可靠项目说明，建议打开仓库查看 README。";
}

function buildFallbackOverview(
  projects: ReportProjectInsight[],
  categories: ReportInsights["categories"],
  previousRun: CollectionRun | undefined,
  newEntries: ReportTrendProject[],
  exitedEntries: ReportTrendProject[]
): string {
  const leadingCategories = categories
    .slice()
    .sort((a, b) => b.projectCount - a.projectCount)
    .slice(0, 3)
    .map((category) => category.label);
  const sentences = [
    `今天共收录 ${projects.length} 个 GitHub Trending 项目，分布在 ${categories.length} 个主题${leadingCategories.length ? `，主要集中于${leadingCategories.join("、")}` : ""}。`
  ];
  const starsToday = sumKnown(projects.map((project) => project.starsToday));
  if (starsToday !== undefined) sentences.push(`已知项目在 Trending 页面合计新增 ${starsToday} Star。`);
  if (previousRun) sentences.push(`与 ${previousRun.businessDate} 相比，新上榜 ${newEntries.length} 个，退出榜单 ${exitedEntries.length} 个。`);
  return sentences.join("");
}

function classifyProject(item: ProjectSnapshot): string {
  const text = `${item.name} ${item.description ?? ""} ${item.language ?? ""} ${item.readmeText.slice(0, 2_000)}`.toLowerCase();
  const rules: Array<[string, string[]]> = [
    ["AI Agent / 智能体", ["agentic", "multi-agent", "autonomous agent", "ai agent", "智能体", "agent framework"]],
    ["大模型与训练推理", ["large language model", "llm", "transformer", "inference", "model serving", "fine-tun", "pytorch", "大模型", "训练框架"]],
    ["数据、搜索与 RAG", ["retrieval augmented", "rag", "vector database", "embedding", "search engine", "database", "data pipeline", "向量数据库", "检索"]],
    ["安全与 OSINT", ["security", "vulnerability", "exploit", "malware", "osint", "penetration", "privacy", "安全"]],
    ["多媒体与设计创作", ["image generation", "video generation", "audio", "speech", "music", "3d", "diffusion", "design tool", "图像", "视频", "音频"]],
    ["基础设施与运维", ["kubernetes", "docker", "devops", "observability", "infrastructure", "terraform", "cloud native", "monitoring", "运维"]],
    ["Web 与应用框架", ["web framework", "frontend", "react", "vue", "next.js", "mobile app", "backend framework", "ui framework", "web 应用"]],
    ["开发者工具", ["developer tool", "code assistant", "cli", "sdk", "ide", "compiler", "linter", "debugger", "代码工具"]]
  ];
  return rules.find(([, keywords]) => keywords.some((keyword) => text.includes(keyword)))?.[0] ?? "其他";
}

function normalizeCategory(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const comparable = value.replace(/\s+/g, "").toLowerCase();
  return REPORT_CATEGORIES.find((category) =>
    category.label.replace(/\s+/g, "").toLowerCase() === comparable
    || category.key.toLowerCase() === comparable
  )?.label;
}

function normalizeComparableUrl(value: string): string {
  const compact = value.trim().replace(/\s*\/\s*/g, "/");
  const githubMatch = compact.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s?#)]+)\/([^/\s?#)]+)/i);
  if (githubMatch) {
    return `github:${githubMatch[1].toLowerCase()}/${githubMatch[2].replace(/\.git$/i, "").toLowerCase()}`;
  }
  const repositoryMatch = compact.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (repositoryMatch) {
    return `github:${repositoryMatch[1].toLowerCase()}/${repositoryMatch[2].replace(/\.git$/i, "").toLowerCase()}`;
  }
  try {
    const url = new URL(compact);
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return compact.replace(/\/+$/, "").toLowerCase();
  }
}

function cleanSourceText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized && !isUnusableSourceText(normalized) ? normalized : undefined;
}

function isUnusableSourceText(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) return false;
  const openingText = normalized.slice(0, 600);
  const placeholders = [
    "there was an error while loading",
    "please reload this page",
    "something went wrong while loading",
    "this page could not be loaded",
    "uh oh!"
  ];
  return placeholders.some((placeholder) => openingText.includes(placeholder));
}

function hasUsableProjectContent(item: ProjectSnapshot): boolean {
  if (cleanSourceText(item.description)) return true;
  if (item.status !== "success") return false;
  return Boolean(cleanSourceText(item.readmeText || stripHtml(item.readmeHtml)));
}
