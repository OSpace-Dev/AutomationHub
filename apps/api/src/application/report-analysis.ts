import type { CollectionRun, ProjectSnapshot, ReportInsights, ReportProjectInsight, ReportTrendProject } from "../models.js";
import { cleanSourceText, hasUsableProjectContent, normalizeComparableUrl, stripHtml } from "./report-source.js";

const MAX_PROJECT_PURPOSE_CHARS = 45;
const MAX_PROJECT_ATTENTION_CHARS = 55;
const DEFAULT_PAGE_SIZE = 20;

export interface ReportPageResult<T> { items: T[]; total: number; page: number; pageSize: number; totalPages: number; }

export interface ModelProjectAnalysis {
  category: string;
  purpose?: string;
  attentionReason?: string;
}

export interface ParsedModelBatch {
  analyses: Map<string, ModelProjectAnalysis>;
  isStructured: boolean;
}

export function mergeModelAnalyses(target: Map<string, ModelProjectAnalysis>, source: Map<string, ModelProjectAnalysis>): void {
  for (const [projectUrl, analysis] of source) {
    const previous = target.get(projectUrl);
    target.set(projectUrl, {
      category: analysis.category || previous?.category || "其他",
      purpose: analysis.purpose ?? previous?.purpose,
      attentionReason: analysis.attentionReason ?? previous?.attentionReason
    });
  }
}

export function findIncompleteProjectUrl(projectUrls: string[], analyses: Map<string, ModelProjectAnalysis>): string | undefined {
  return projectUrls.find((projectUrl) => !isCompleteModelAnalysis(analyses.get(normalizeComparableUrl(projectUrl))));
}

export function paginate<T>(values: T[], requestedPage = 1, requestedPageSize = DEFAULT_PAGE_SIZE): ReportPageResult<T> {
  const pageSize = Math.min(Math.max(Number.isFinite(requestedPageSize) ? Math.trunc(requestedPageSize) : DEFAULT_PAGE_SIZE, 1), 100);
  const total = values.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1, 1), totalPages);
  return { items: values.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize, totalPages };
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

export function parseModelBatch(value: string, expectedProjectUrls: string[]): ParsedModelBatch {
  const analyses = new Map<string, ModelProjectAnalysis>();
  const expected = new Set(expectedProjectUrls.map(normalizeComparableUrl));
  const candidate = extractJsonObject(value);
  if (!candidate) return { analyses, isStructured: false };
  try {
    const parsed = JSON.parse(candidate) as { project_analyses?: unknown; project_categories?: unknown };
    const entries = Array.isArray(parsed.project_analyses) ? parsed.project_analyses : Array.isArray(parsed.project_categories) ? parsed.project_categories : null;
    if (!entries) return { analyses, isStructured: false };
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const fields = entry as { project_url?: unknown; url?: unknown; repository?: unknown; project?: unknown; category?: unknown; purpose?: unknown; attention_reason?: unknown; attentionReason?: unknown };
      const projectReference = [fields.project_url, fields.url, fields.repository, fields.project].find((field): field is string => typeof field === "string" && Boolean(field.trim()));
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

export function isCompleteModelAnalysis(value: ModelProjectAnalysis | undefined): boolean {
  return Boolean(value?.category && value.purpose && value.attentionReason);
}

export function buildReportInsights(currentItems: ProjectSnapshot[], previousRun: CollectionRun | undefined, previousItems: ProjectSnapshot[], modelAnalyses: Map<string, ModelProjectAnalysis>): ReportInsights {
  const ranked = currentItems.slice().sort((a, b) => a.rank - b.rank);
  const previousByUrl = new Map(previousItems.map((item) => [normalizeComparableUrl(item.normalizedProjectUrl), item]));
  const currentUrls = new Set(ranked.map((item) => normalizeComparableUrl(item.normalizedProjectUrl)));
  let analysisFallbackCount = 0;
  const projects: ReportProjectInsight[] = ranked.map((item) => {
    const previous = previousByUrl.get(normalizeComparableUrl(item.normalizedProjectUrl));
    const analysis = modelAnalyses.get(normalizeComparableUrl(item.projectUrl));
    const hasUsableContent = hasUsableProjectContent(item);
    if (hasUsableContent && (!analysis?.category || !analysis.purpose || !analysis.attentionReason)) analysisFallbackCount += 1;
    const category = hasUsableContent ? analysis?.category ?? classifyProject(item) : "其他";
    return {
      projectUrl: item.projectUrl,
      name: item.name,
      rank: item.rank,
      category,
      purpose: hasUsableContent ? analysis?.purpose ?? buildProjectPurpose(item) : "暂无可靠项目说明。",
      attentionReason: hasUsableContent ? analysis?.attentionReason ?? buildAttentionReason() : "采集内容不足，当前仅保留榜单数据，建议重新采集后分析。",
      description: cleanSourceText(item.description),
      language: item.language,
      totalStars: item.totalStars,
      starsToday: item.starsToday,
      totalStarsDelta: item.totalStars !== undefined && previous?.totalStars !== undefined ? item.totalStars - previous.totalStars : undefined
    };
  });
  const categories = REPORT_CATEGORIES.map((category) => {
    const categoryProjects = projects.filter((project) => project.category === category.label);
    return { key: category.key, label: category.label, projectCount: categoryProjects.length, totalStars: sumKnown(categoryProjects.map((project) => project.totalStars)), starsToday: sumKnown(categoryProjects.map((project) => project.starsToday)), projects: categoryProjects };
  }).filter((category) => category.projectCount > 0);
  const continuedEntries: ReportTrendProject[] = [];
  const newEntries: ReportTrendProject[] = [];
  for (const project of projects) {
    const previous = previousByUrl.get(normalizeComparableUrl(project.projectUrl));
    if (!previous) { newEntries.push(toTrendProject(project)); continue; }
    continuedEntries.push({ ...toTrendProject(project), previousRank: previous.rank, rankChange: previous.rank - project.rank });
  }
  const exitedEntries = previousItems.filter((item) => !currentUrls.has(normalizeComparableUrl(item.normalizedProjectUrl))).sort((a, b) => a.rank - b.rank).map((item) => ({ projectUrl: item.projectUrl, name: item.name, previousRank: item.rank }));
  const comparableDeltas = projects.map((project) => project.totalStarsDelta).filter((value): value is number => value !== undefined);
  return {
    presentationVersion: 2,
    overview: buildFallbackOverview(projects, categories, previousRun, newEntries, exitedEntries),
    metrics: { projectCount: projects.length, totalStars: sumKnown(projects.map((project) => project.totalStars)), starsToday: sumKnown(projects.map((project) => project.starsToday)), categoryCount: categories.length, totalStarsDelta: previousRun && comparableDeltas.length ? comparableDeltas.reduce((sum, value) => sum + value, 0) : undefined, knownTotalStarsCount: projects.filter((project) => project.totalStars !== undefined).length, knownStarsTodayCount: projects.filter((project) => project.starsToday !== undefined).length, comparableProjectCount: comparableDeltas.length, analysisFallbackCount },
    categories,
    trends: { hasComparison: Boolean(previousRun), comparisonDate: previousRun?.businessDate, newEntries: previousRun ? newEntries : [], continuedEntries: previousRun ? continuedEntries : [], exitedEntries: previousRun ? exitedEntries : [], risingEntries: previousRun ? continuedEntries.filter((project) => (project.rankChange ?? 0) > 0) : [], fallingEntries: previousRun ? continuedEntries.filter((project) => (project.rankChange ?? 0) < 0) : [], unchangedEntries: previousRun ? continuedEntries.filter((project) => project.rankChange === 0) : [] }
  };
}

function extractJsonObject(value: string): string | null { const trimmed = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""); const start = trimmed.indexOf("{"); const end = trimmed.lastIndexOf("}"); return start >= 0 && end > start ? trimmed.slice(start, end + 1) : null; }
function normalizeModelText(value: unknown, maxLength: number): string | undefined { if (typeof value !== "string") return undefined; const normalized = value.replace(/\s+/g, " ").trim(); return normalized && !isUnusableSourceText(normalized) ? normalized.slice(0, maxLength) : undefined; }
function buildProjectPurpose(item: ProjectSnapshot): string { const description = cleanSourceText(item.description); if (description) return description.slice(0, MAX_PROJECT_PURPOSE_CHARS); const readmeSource = item.status === "success" ? item.readmeText || stripHtml(item.readmeHtml) : ""; const readme = cleanSourceText(readmeSource.replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/^#{1,6}\s+/gm, "").replace(/[`*_>|-]/g, " ").replace(/\s+/g, " ").trim()); return readme ? readme.slice(0, MAX_PROJECT_PURPOSE_CHARS) : "暂无可靠项目说明。"; }
function buildAttentionReason(): string { return "自动分析未完整返回，已保留可靠项目说明，建议打开仓库查看 README。"; }
function buildFallbackOverview(projects: ReportProjectInsight[], categories: ReportInsights["categories"], previousRun: CollectionRun | undefined, newEntries: ReportTrendProject[], exitedEntries: ReportTrendProject[]): string { const leadingCategories = categories.slice().sort((a, b) => b.projectCount - a.projectCount).slice(0, 3).map((category) => category.label); const sentences = [`今天共收录 ${projects.length} 个 GitHub Trending 项目，分布在 ${categories.length} 个主题${leadingCategories.length ? `，主要集中于${leadingCategories.join("、")}` : ""}。`]; const starsToday = sumKnown(projects.map((project) => project.starsToday)); if (starsToday !== undefined) sentences.push(`已知项目在 Trending 页面合计新增 ${starsToday} Star。`); if (previousRun) sentences.push(`与 ${previousRun.businessDate} 相比，新上榜 ${newEntries.length} 个，退出榜单 ${exitedEntries.length} 个。`); return sentences.join(""); }
function classifyProject(item: ProjectSnapshot): string { const text = `${item.name} ${item.description ?? ""} ${item.language ?? ""} ${item.readmeText.slice(0, 2_000)}`.toLowerCase(); const rules: Array<[string, string[]]> = [["AI Agent / 智能体", ["agentic", "multi-agent", "autonomous agent", "ai agent", "智能体", "agent framework"]], ["大模型与训练推理", ["large language model", "llm", "transformer", "inference", "model serving", "fine-tun", "pytorch", "大模型", "训练框架"]], ["数据、搜索与 RAG", ["retrieval augmented", "rag", "vector database", "embedding", "search engine", "database", "data pipeline", "向量数据库", "检索"]], ["安全与 OSINT", ["security", "vulnerability", "exploit", "malware", "osint", "penetration", "privacy", "安全"]], ["多媒体与设计创作", ["image generation", "video generation", "audio", "speech", "music", "3d", "diffusion", "design tool", "图像", "视频", "音频"]], ["基础设施与运维", ["kubernetes", "docker", "devops", "observability", "infrastructure", "terraform", "cloud native", "monitoring", "运维"]], ["Web 与应用框架", ["web framework", "frontend", "react", "vue", "next.js", "mobile app", "backend framework", "ui framework", "web 应用"]], ["开发者工具", ["developer tool", "code assistant", "cli", "sdk", "ide", "compiler", "linter", "debugger", "代码工具"]]]; return rules.find(([, keywords]) => keywords.some((keyword) => text.includes(keyword)))?.[0] ?? "其他"; }
function normalizeCategory(value: unknown): string | undefined { if (typeof value !== "string") return undefined; const comparable = value.replace(/\s+/g, "").toLowerCase(); return REPORT_CATEGORIES.find((category) => category.label.replace(/\s+/g, "").toLowerCase() === comparable || category.key.toLowerCase() === comparable)?.label; }
function isUnusableSourceText(value: string): boolean { const openingText = value.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 600); return ["there was an error while loading", "please reload this page", "something went wrong while loading", "this page could not be loaded", "uh oh!"].some((placeholder) => openingText.includes(placeholder)); }
function toTrendProject(project: ReportProjectInsight): ReportTrendProject { return { projectUrl: project.projectUrl, name: project.name, currentRank: project.rank, totalStarsDelta: project.totalStarsDelta }; }
function sumKnown(values: Array<number | undefined>): number | undefined { const known = values.filter((value): value is number => value !== undefined); return known.length ? known.reduce((sum, value) => sum + value, 0) : undefined; }
