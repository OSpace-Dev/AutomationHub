import { ApiError } from "../shared/errors.js";
import type { CollectionRun, ProjectSnapshot, ReportDefinition } from "../domain/models.js";
import type { ReportRunData } from "./ports/report-persistence-port.js";

const MAX_README_CHARS = 1_500;
const MAX_BATCH_INPUT_CHARS = 18_000;
const PROJECT_BATCH_SIZE = 4;

export interface ReportSourceInput {
  run: CollectionRun;
  items: ProjectSnapshot[];
  previousRun?: CollectionRun;
  previousItems: ProjectSnapshot[];
}

export interface PreparedReportBatch {
  itemCount: number;
  projectUrls: string[];
  requiredProjectUrls: string[];
  messages: Array<{ role: "system" | "user"; content: string }>;
}

const CATEGORY_RESPONSE_INSTRUCTION = `你正在分析日报中的一小批项目。必须只返回一个 JSON 对象，不要使用 Markdown 代码围栏。格式如下：
{"project_analyses":[{"project_url":"输入中的完整项目地址","category":"预设分类名称","purpose":"一句话说明项目做什么","attention_reason":"一句话说明为什么值得关注"}]}
每个项目必须且只能出现一次。category 只能从以下名称中选择：AI Agent / 智能体、大模型与训练推理、数据、搜索与 RAG、开发者工具、Web 与应用框架、基础设施与运维、安全与 OSINT、多媒体与设计创作、其他。
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

export function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export function findPreviousRun(data: ReportRunData, currentRun: CollectionRun): CollectionRun | undefined {
  const runIdsWithItems = new Set(data.items.map((item) => item.runId));
  return data.runs
    .filter((run) => run.id !== currentRun.id
      && run.businessDate < currentRun.businessDate
      && run.sourceUrl.includes("github.com/trending")
      && runIdsWithItems.has(run.id))
    .sort((a, b) => b.businessDate.localeCompare(a.businessDate) || b.createdAt.localeCompare(a.createdAt))[0];
}

export function normalizeComparableUrl(value: string): string {
  const compact = value.trim().replace(/\s*\/\s*/g, "/");
  const githubMatch = compact.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([^\/\s?#)]+)\/([^\/\s?#)]+)/i);
  if (githubMatch) return `github:${githubMatch[1].toLowerCase()}/${githubMatch[2].replace(/\.git$/i, "").toLowerCase()}`;
  const repositoryMatch = compact.match(/^([^\/\s]+)\/([^\/\s]+)$/);
  if (repositoryMatch) return `github:${repositoryMatch[1].toLowerCase()}/${repositoryMatch[2].replace(/\.git$/i, "").toLowerCase()}`;
  try {
    const url = new URL(compact);
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return compact.replace(/\/+$/, "").toLowerCase();
  }
}

export function cleanSourceText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized && !isUnusableSourceText(normalized) ? normalized : undefined;
}

export function isUnusableSourceText(value: string): boolean {
  const openingText = value.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 600);
  if (!openingText) return false;
  return ["there was an error while loading", "please reload this page", "something went wrong while loading", "this page could not be loaded", "uh oh!"].some((placeholder) => openingText.includes(placeholder));
}

export function hasUsableProjectContent(item: ProjectSnapshot): boolean {
  if (cleanSourceText(item.description)) return true;
  if (item.status !== "success") return false;
  return Boolean(cleanSourceText(item.readmeText || stripHtml(item.readmeHtml)));
}
