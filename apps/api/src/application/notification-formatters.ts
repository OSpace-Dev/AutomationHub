import { SecretVault } from "../crypto.js";
import { ApiError } from "../errors.js";
import type {
  NotificationChannel,
  NotificationTarget,
  ReportDelivery,
  ReportGeneration,
  StoreData
} from "../models.js";
import type { TelegramChat } from "../telegram-service.js";

const MAX_ERROR_LENGTH = 240;
const REPORT_SUMMARY_LENGTH = 720;

export interface NotificationChannelInput {
  name: string;
  botToken?: string;
  proxyUrl?: string;
  proxyEnabled?: boolean;
  enabled: boolean;
}

export interface NotificationTargetInput {
  name: string;
  chatId: string;
  enabled: boolean;
}

export interface NotificationChannelView {
  id: string;
  type: "telegram";
  name: string;
  botTokenConfigured: boolean;
  botTokenHint: string;
  proxyConfigured: boolean;
  proxyUrlHint?: string;
  proxyEnabled: boolean;
  botUsername?: string;
  botDisplayName?: string;
  enabled: boolean;
  lastVerifiedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TelegramChatView extends TelegramChat {
  alreadyConfigured: boolean;
}

export interface ReportDeliveryView {
  id: string;
  reportGenerationId: string;
  channelId: string;
  channelName?: string;
  targetId: string;
  targetName?: string;
  chatId?: string;
  status: ReportDelivery["status"];
  attemptCount: number;
  messageCount?: number;
  lastError?: string;
  createdAt: string;
  startedAt?: string;
  sentAt?: string;
  completedAt?: string;
}

export function findChannel(data: StoreData, id: string): NotificationChannel {
  const channel = data.notificationChannels.find((entry) => entry.id === id);
  if (!channel) throw channelNotFound();
  return channel;
}

export function findTarget(data: StoreData, channelId: string, targetId: string): NotificationTarget {
  const target = data.notificationTargets.find((entry) => entry.channelId === channelId && entry.id === targetId);
  if (!target) throw targetNotFound();
  return target;
}

export function channelNotFound(): ApiError {
  return new ApiError(404, "notification_channel_not_found", "Notification channel was not found");
}

export function targetNotFound(): ApiError {
  return new ApiError(404, "notification_target_not_found", "Notification target was not found");
}

export function requiredName(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) throw new ApiError(400, "notification_name_required", "Name is required");
  return normalized.slice(0, 100);
}

export function requiredToken(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) throw new ApiError(400, "telegram_bot_token_required", "Telegram Bot Token is required");
  return normalized;
}

export function requiredChatId(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) throw new ApiError(400, "telegram_chat_id_required", "Telegram chat ID is required");
  return normalized;
}

export function optionalProxyUrl(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw invalidProxy();
  }
  if (!["http:", "https:", "socks5:"].includes(parsed.protocol) || !parsed.hostname) {
    throw invalidProxy();
  }
  return parsed.toString();
}

export function requireEnabledProxy(enabled: boolean, proxyUrl: string | undefined): void {
  if (enabled && !proxyUrl) {
    throw new ApiError(400, "telegram_proxy_required", "启用 Telegram 代理前需要填写代理 URL");
  }
}

export function invalidProxy(): ApiError {
  return new ApiError(400, "telegram_proxy_invalid", "代理 URL 必须使用 http、https 或 socks5 协议");
}

export function decryptConfiguredProxy(channel: NotificationChannel, vault: SecretVault): string | undefined {
  if (channel.proxyUrl) return channel.proxyUrl;
  return channel.encryptedProxyUrl ? vault.decrypt(channel.encryptedProxyUrl) : undefined;
}

export function enabledProxyUrl(channel: NotificationChannel, vault: SecretVault): string | undefined {
  if (channel.proxyEnabled !== true) return undefined;
  const proxyUrl = decryptConfiguredProxy(channel, vault);
  requireEnabledProxy(true, proxyUrl);
  return proxyUrl;
}

export function proxyHint(proxyUrl: string): string {
  const parsed = new URL(proxyUrl);
  return `${parsed.protocol}//${parsed.host}`;
}

export function tokenHint(token: string): string {
  return token.length <= 4 ? "••••" : `••••${token.slice(-4)}`;
}

export function toChannelView(channel: NotificationChannel): NotificationChannelView {
  return {
    id: channel.id,
    type: channel.type,
    name: channel.name,
    botTokenConfigured: true,
    botTokenHint: channel.botTokenHint,
    proxyConfigured: Boolean(channel.proxyUrl || channel.encryptedProxyUrl),
    proxyUrlHint: channel.proxyUrlHint,
    proxyEnabled: channel.proxyEnabled === true,
    botUsername: channel.botUsername,
    botDisplayName: channel.botDisplayName,
    enabled: channel.enabled,
    lastVerifiedAt: channel.lastVerifiedAt,
    lastError: channel.lastError,
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt
  };
}

export function extractTelegramChat(value: unknown): TelegramChat | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as {
    id?: unknown;
    type?: unknown;
    title?: unknown;
    username?: unknown;
    first_name?: unknown;
    last_name?: unknown;
    chat?: unknown;
  };
  if (candidate.chat && candidate.chat !== value) return extractTelegramChat(candidate.chat);
  if ((typeof candidate.id !== "number" && typeof candidate.id !== "string") || typeof candidate.type !== "string") return undefined;
  return {
    id: String(candidate.id),
    type: candidate.type,
    title: typeof candidate.title === "string" ? candidate.title : undefined,
    username: typeof candidate.username === "string" ? candidate.username : undefined,
    firstName: typeof candidate.first_name === "string" ? candidate.first_name : undefined,
    lastName: typeof candidate.last_name === "string" ? candidate.last_name : undefined
  };
}

export function chatLabel(chat: TelegramChat): string {
  return chat.title
    || [chat.firstName, chat.lastName].filter(Boolean).join(" ")
    || (chat.username ? `@${chat.username}` : "")
    || chat.id;
}

export function toDeliveryView(delivery: ReportDelivery, data: StoreData): ReportDeliveryView {
  const channel = data.notificationChannels.find((entry) => entry.id === delivery.channelId);
  const target = data.notificationTargets.find((entry) => entry.id === delivery.targetId);
  return {
    id: delivery.id,
    reportGenerationId: delivery.reportGenerationId,
    channelId: delivery.channelId,
    channelName: channel?.name,
    targetId: delivery.targetId,
    targetName: target?.name,
    chatId: target?.chatId,
    status: delivery.status,
    attemptCount: delivery.attemptCount,
    messageCount: delivery.messageCount,
    lastError: delivery.lastError,
    createdAt: delivery.createdAt,
    startedAt: delivery.startedAt,
    sentAt: delivery.sentAt,
    completedAt: delivery.completedAt
  };
}

export function formatReportMessage(report: ReportGeneration, publicReportUrl: string): string {
  const metrics = report.insights?.metrics;
  const projects = report.insights?.categories
    .flatMap((category) => category.projects)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 5) ?? [];
  const summary = compactReportSummary(report.insights?.overview || report.content || "日报已生成。");
  const lines = [
    `AutomationHub 日报｜${report.businessDate}`,
    summary,
    metrics ? `项目 ${metrics.projectCount} 个｜分类 ${metrics.categoryCount} 个${metrics.starsToday === undefined ? "" : `｜今日新增 ${metrics.starsToday} Star`}` : "",
    projects.length ? `\n重点项目\n${projects.map((project) => `${project.rank}. ${project.name}`).join("\n")}` : "",
    `\n公开阅读：${publicReportUrl}`
  ];
  return lines.filter(Boolean).join("\n");
}

export function requirePublicReportUrl(report: ReportGeneration, publicBaseUrl?: string): string {
  const normalizedBaseUrl = publicBaseUrl?.trim().replace(/\/+$/, "");
  if (!normalizedBaseUrl) {
    throw new ApiError(409, "public_report_url_unavailable", "日报推送需要配置 PUBLIC_BASE_URL");
  }
  if (!report.shareToken) {
    throw new ApiError(409, "public_report_url_unavailable", "日报缺少公开分享标识，无法推送");
  }
  return `${normalizedBaseUrl}/share/reports/${encodeURIComponent(report.shareToken)}`;
}

function compactReportSummary(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim() || "日报已生成。";
  const characters = Array.from(normalized);
  return characters.length <= REPORT_SUMMARY_LENGTH
    ? normalized
    : `${characters.slice(0, REPORT_SUMMARY_LENGTH - 1).join("")}…`;
}

export function publicErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message.slice(0, MAX_ERROR_LENGTH);
  return "Telegram 请求失败";
}
