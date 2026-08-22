import { SecretVault, createId } from "./crypto.js";
import { ApiError } from "./errors.js";
import type {
  NotificationChannel,
  NotificationTarget,
  ReportDelivery,
  ReportGeneration,
  StoreData
} from "./models.js";
import type { Store } from "./store.js";
import { TelegramClient, type TelegramChat } from "./telegram-service.js";

const DEFAULT_PAGE_SIZE = 100;
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

export class ReportDeliveryService {
  private processing = false;
  private stopped = false;
  private wakeTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly store: Store,
    private readonly vault: SecretVault,
    private readonly telegram = new TelegramClient(),
    private readonly publicBaseUrl?: string
  ) {}

  async start(): Promise<void> {
    await this.recoverInterrupted();
    this.wake();
  }

  stop(): void {
    this.stopped = true;
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.telegram.close();
  }

  wake(): void {
    if (this.stopped || this.wakeTimer) return;
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = undefined;
      void this.processLoop();
    }, 0);
    this.wakeTimer.unref?.();
  }

  async listChannels(): Promise<NotificationChannelView[]> {
    const data = await this.store.read();
    return data.notificationChannels
      .slice()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(toChannelView);
  }

  async createChannel(input: NotificationChannelInput): Promise<NotificationChannelView> {
    const name = requiredName(input.name);
    const token = requiredToken(input.botToken);
    const proxyUrl = optionalProxyUrl(input.proxyUrl);
    const proxyEnabled = input.proxyEnabled ?? false;
    requireEnabledProxy(proxyEnabled, proxyUrl);
    const bot = await this.telegram.getMe(token, proxyEnabled ? proxyUrl : undefined);
    return this.store.update((data) => {
      const now = new Date().toISOString();
      const channel: NotificationChannel = {
        id: createId(),
        type: "telegram",
        name,
        encryptedBotToken: this.vault.encrypt(token),
        botTokenHint: tokenHint(token),
        proxyUrl,
        proxyUrlHint: proxyUrl ? proxyHint(proxyUrl) : undefined,
        proxyEnabled,
        botUsername: bot.username,
        botDisplayName: bot.firstName,
        enabled: input.enabled,
        lastVerifiedAt: now,
        createdAt: now,
        updatedAt: now
      };
      data.notificationChannels.push(channel);
      return toChannelView(channel);
    });
  }

  async updateChannel(id: string, input: Partial<NotificationChannelInput>): Promise<NotificationChannelView> {
    const data = await this.store.read();
    const existing = findChannel(data, id);
    const replacementToken = input.botToken?.trim();
    const token = replacementToken || this.vault.decrypt(existing.encryptedBotToken);
    const proxyUrl = input.proxyUrl === undefined
      ? decryptConfiguredProxy(existing, this.vault)
      : optionalProxyUrl(input.proxyUrl);
    const proxyEnabled = input.proxyEnabled ?? existing.proxyEnabled === true;
    requireEnabledProxy(proxyEnabled, proxyUrl);
    const proxyEnabledChanged = input.proxyEnabled !== undefined
      && input.proxyEnabled !== (existing.proxyEnabled === true);
    const shouldVerify = Boolean(replacementToken)
      || input.proxyUrl !== undefined
      || proxyEnabledChanged;
    const bot = shouldVerify
      ? await this.telegram.getMe(token, proxyEnabled ? proxyUrl : undefined)
      : undefined;
    return this.store.update((data) => {
      const channel = findChannel(data, id);
      if (input.name !== undefined) channel.name = requiredName(input.name);
      if (input.enabled !== undefined) channel.enabled = input.enabled;
      if (input.proxyUrl !== undefined) {
        channel.proxyUrl = proxyUrl;
        channel.encryptedProxyUrl = undefined;
        channel.proxyUrlHint = proxyUrl ? proxyHint(proxyUrl) : undefined;
      }
      if (input.proxyEnabled !== undefined || input.proxyUrl !== undefined) {
        channel.proxyEnabled = proxyEnabled;
      }
      if (replacementToken) {
        channel.encryptedBotToken = this.vault.encrypt(replacementToken);
        channel.botTokenHint = tokenHint(replacementToken);
      }
      if (bot) {
        channel.botUsername = bot?.username;
        channel.botDisplayName = bot?.firstName;
        channel.lastVerifiedAt = new Date().toISOString();
        channel.lastError = undefined;
      }
      channel.updatedAt = new Date().toISOString();
      return toChannelView(channel);
    });
  }

  async removeChannel(id: string): Promise<NotificationChannelView> {
    return this.store.update((data) => {
      const index = data.notificationChannels.findIndex((entry) => entry.id === id);
      if (index < 0) throw channelNotFound();
      const [channel] = data.notificationChannels.splice(index, 1);
      data.notificationTargets = data.notificationTargets.filter((target) => target.channelId !== id);
      return toChannelView(channel);
    });
  }

  async verifyChannel(id: string): Promise<NotificationChannelView> {
    const data = await this.store.read();
    const channel = findChannel(data, id);
    try {
      const bot = await this.telegram.getMe(
        this.vault.decrypt(channel.encryptedBotToken),
        enabledProxyUrl(channel, this.vault)
      );
      return this.store.update((next) => {
        const current = findChannel(next, id);
        current.botUsername = bot.username;
        current.botDisplayName = bot.firstName;
        current.lastVerifiedAt = new Date().toISOString();
        current.lastError = undefined;
        current.updatedAt = new Date().toISOString();
        return toChannelView(current);
      });
    } catch (error) {
      await this.recordChannelError(id, publicErrorMessage(error));
      throw error;
    }
  }

  async discoverChats(channelId: string): Promise<TelegramChatView[]> {
    const data = await this.store.read();
    const channel = findChannel(data, channelId);
    try {
      const updates = await this.telegram.getUpdates(
        this.vault.decrypt(channel.encryptedBotToken),
        enabledProxyUrl(channel, this.vault)
      );
      const configuredIds = new Set(
        data.notificationTargets
          .filter((target) => target.channelId === channelId)
          .map((target) => target.chatId)
      );
      const chats = new Map<string, TelegramChat>();
      for (const update of updates) {
        for (const candidate of Object.values(update)) {
          const chat = extractTelegramChat(candidate);
          if (!chat || chats.has(chat.id)) continue;
          chats.set(chat.id, chat);
        }
      }
      return [...chats.values()]
        .sort((a, b) => chatLabel(a).localeCompare(chatLabel(b), "zh-CN"))
        .map((chat) => ({ ...chat, alreadyConfigured: configuredIds.has(chat.id) }));
    } catch (error) {
      await this.recordChannelError(channelId, publicErrorMessage(error));
      throw error;
    }
  }

  async sendTestChat(channelId: string, chatId: string): Promise<void> {
    const data = await this.store.read();
    const channel = findChannel(data, channelId);
    await this.telegram.sendMessage(
      this.vault.decrypt(channel.encryptedBotToken),
      requiredChatId(chatId),
      "AutomationHub 测试消息：连接正常。",
      enabledProxyUrl(channel, this.vault)
    );
  }

  async listTargets(channelId: string): Promise<NotificationTarget[]> {
    const data = await this.store.read();
    findChannel(data, channelId);
    return data.notificationTargets
      .filter((target) => target.channelId === channelId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((target) => structuredClone(target));
  }

  async createTarget(channelId: string, input: NotificationTargetInput): Promise<NotificationTarget> {
    return this.store.update((data) => {
      findChannel(data, channelId);
      const now = new Date().toISOString();
      const target: NotificationTarget = {
        id: createId(),
        channelId,
        name: requiredName(input.name),
        chatId: requiredChatId(input.chatId),
        enabled: input.enabled,
        createdAt: now,
        updatedAt: now
      };
      data.notificationTargets.push(target);
      return structuredClone(target);
    });
  }

  async updateTarget(channelId: string, targetId: string, input: Partial<NotificationTargetInput>): Promise<NotificationTarget> {
    return this.store.update((data) => {
      findChannel(data, channelId);
      const target = findTarget(data, channelId, targetId);
      if (input.name !== undefined) target.name = requiredName(input.name);
      if (input.chatId !== undefined) target.chatId = requiredChatId(input.chatId);
      if (input.enabled !== undefined) target.enabled = input.enabled;
      target.updatedAt = new Date().toISOString();
      return structuredClone(target);
    });
  }

  async removeTarget(channelId: string, targetId: string): Promise<NotificationTarget> {
    return this.store.update((data) => {
      findChannel(data, channelId);
      const index = data.notificationTargets.findIndex((target) => target.channelId === channelId && target.id === targetId);
      if (index < 0) throw targetNotFound();
      const [target] = data.notificationTargets.splice(index, 1);
      return structuredClone(target);
    });
  }

  async sendTest(channelId: string, targetId: string): Promise<void> {
    const data = await this.store.read();
    const channel = findChannel(data, channelId);
    const target = findTarget(data, channelId, targetId);
    const token = this.vault.decrypt(channel.encryptedBotToken);
    await this.telegram.sendMessage(
      token,
      target.chatId,
      "AutomationHub Telegram 渠道测试消息\n如果你看到这条消息，日报推送配置已生效。",
      enabledProxyUrl(channel, this.vault)
    );
  }

  async enqueueForCompletedReport(reportId: string): Promise<ReportDeliveryView[]> {
    const deliveries = await this.createDeliveries(reportId, false);
    if (deliveries.length) this.wake();
    return deliveries;
  }

  async listDeliveries(reportId: string): Promise<ReportDeliveryView[]> {
    const data = await this.store.read();
    if (!data.reportGenerations.some((report) => report.id === reportId)) {
      throw new ApiError(404, "report_not_found", "Report generation was not found");
    }
    return data.reportDeliveries
      .filter((delivery) => delivery.reportGenerationId === reportId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((delivery) => toDeliveryView(delivery, data));
  }

  async enqueueManual(reportId: string): Promise<ReportDeliveryView[]> {
    const deliveries = await this.createDeliveries(reportId, true);
    if (deliveries.length) this.wake();
    return deliveries;
  }

  async retryDelivery(id: string): Promise<ReportDeliveryView> {
    const delivery = await this.store.update((data) => {
      const current = data.reportDeliveries.find((entry) => entry.id === id);
      if (!current) throw new ApiError(404, "report_delivery_not_found", "Report delivery was not found");
      if (current.status !== "failed") throw new ApiError(409, "report_delivery_not_failed", "Only failed report deliveries can be retried");
      current.status = "pending";
      current.lastError = undefined;
      current.startedAt = undefined;
      current.completedAt = undefined;
      return structuredClone(current);
    });
    this.wake();
    const data = await this.store.read();
    return toDeliveryView(delivery, data);
  }

  private async createDeliveries(reportId: string, resendExisting: boolean): Promise<ReportDeliveryView[]> {
    return this.store.update((data) => {
      const report = data.reportGenerations.find((entry) => entry.id === reportId);
      if (!report) throw new ApiError(404, "report_not_found", "Report generation was not found");
      if (report.status !== "completed") throw new ApiError(409, "report_not_completed", "Only completed reports can be sent");
      const now = new Date().toISOString();
      const activeTargetIds = new Set<string>();
      for (const channel of data.notificationChannels.filter((entry) => entry.enabled)) {
        for (const target of data.notificationTargets.filter((entry) => entry.channelId === channel.id && entry.enabled)) {
          activeTargetIds.add(target.id);
          const existing = data.reportDeliveries.find((entry) => entry.reportGenerationId === reportId && entry.targetId === target.id);
          if (existing) {
            if (resendExisting && (existing.status === "sent" || existing.status === "failed")) {
              existing.status = "pending";
              existing.messageCount = undefined;
              existing.lastError = undefined;
              existing.startedAt = undefined;
              existing.sentAt = undefined;
              existing.completedAt = undefined;
            }
            continue;
          }
          data.reportDeliveries.push({
            id: createId(),
            reportGenerationId: reportId,
            channelId: channel.id,
            targetId: target.id,
            status: "pending",
            attemptCount: 0,
            createdAt: now
          });
        }
      }
      return data.reportDeliveries
        .filter((delivery) => delivery.reportGenerationId === reportId && activeTargetIds.has(delivery.targetId))
        .map((delivery) => toDeliveryView(delivery, data));
    });
  }

  private async processLoop(): Promise<void> {
    if (this.processing || this.stopped) return;
    this.processing = true;
    try {
      while (!this.stopped) {
        const delivery = await this.claimNext();
        if (!delivery) break;
        await this.processOne(delivery);
      }
    } finally {
      this.processing = false;
    }
  }

  private async claimNext(): Promise<ReportDelivery | null> {
    const snapshot = await this.store.read();
    if (!snapshot.reportDeliveries.some((entry) => entry.status === "pending")) return null;
    return this.store.update((data) => {
      const delivery = data.reportDeliveries
        .filter((entry) => entry.status === "pending")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (!delivery) return null;
      delivery.status = "sending";
      delivery.startedAt = new Date().toISOString();
      delivery.attemptCount += 1;
      return structuredClone(delivery);
    });
  }

  private async processOne(delivery: ReportDelivery): Promise<void> {
    try {
      const data = await this.store.read();
      const current = data.reportDeliveries.find((entry) => entry.id === delivery.id);
      const report = current && data.reportGenerations.find((entry) => entry.id === current.reportGenerationId);
      const channel = current && data.notificationChannels.find((entry) => entry.id === current.channelId);
      const target = current && data.notificationTargets.find((entry) => entry.id === current.targetId);
      if (!current || !report || report.status !== "completed" || !channel || !target) {
        throw new ApiError(409, "telegram_send_failed", "日报推送配置或日报内容不可用");
      }
      const token = this.vault.decrypt(channel.encryptedBotToken);
      const proxyUrl = enabledProxyUrl(channel, this.vault);
      const messages = TelegramClient.splitText(formatReportMessage(report, requirePublicReportUrl(report, this.publicBaseUrl)));
      for (const message of messages) await this.telegram.sendMessage(token, target.chatId, message, proxyUrl);
      await this.store.update((next) => {
        const completed = next.reportDeliveries.find((entry) => entry.id === delivery.id);
        if (!completed) return;
        const sentAt = new Date().toISOString();
        completed.status = "sent";
        completed.messageCount = messages.length;
        completed.lastError = undefined;
        completed.sentAt = sentAt;
        completed.completedAt = sentAt;
      });
    } catch (error) {
      const safe = error instanceof ApiError ? error : new ApiError(502, "telegram_send_failed", "Telegram 消息发送失败", true);
      await this.store.update((data) => {
        const failed = data.reportDeliveries.find((entry) => entry.id === delivery.id);
        if (!failed) return;
        failed.status = "failed";
        failed.lastError = publicErrorMessage(safe);
        failed.completedAt = new Date().toISOString();
      });
    }
  }

  private async recoverInterrupted(): Promise<void> {
    const snapshot = await this.store.read();
    if (!snapshot.reportDeliveries.some((delivery) => delivery.status === "sending")) return;
    await this.store.update((data) => {
      for (const delivery of data.reportDeliveries) {
        if (delivery.status === "sending") {
          delivery.status = "pending";
          delivery.startedAt = undefined;
        }
      }
    });
  }

  private async recordChannelError(id: string, message: string): Promise<void> {
    await this.store.update((data) => {
      const channel = data.notificationChannels.find((entry) => entry.id === id);
      if (!channel) return;
      channel.lastError = message.slice(0, MAX_ERROR_LENGTH);
      channel.updatedAt = new Date().toISOString();
    });
  }
}

function findChannel(data: StoreData, id: string): NotificationChannel {
  const channel = data.notificationChannels.find((entry) => entry.id === id);
  if (!channel) throw channelNotFound();
  return channel;
}

function findTarget(data: StoreData, channelId: string, targetId: string): NotificationTarget {
  const target = data.notificationTargets.find((entry) => entry.channelId === channelId && entry.id === targetId);
  if (!target) throw targetNotFound();
  return target;
}

function channelNotFound(): ApiError {
  return new ApiError(404, "notification_channel_not_found", "Notification channel was not found");
}

function targetNotFound(): ApiError {
  return new ApiError(404, "notification_target_not_found", "Notification target was not found");
}

function requiredName(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) throw new ApiError(400, "notification_name_required", "Name is required");
  return normalized.slice(0, 100);
}

function requiredToken(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) throw new ApiError(400, "telegram_bot_token_required", "Telegram Bot Token is required");
  return normalized;
}

function requiredChatId(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) throw new ApiError(400, "telegram_chat_id_required", "Telegram chat ID is required");
  return normalized;
}

function optionalProxyUrl(value: string | undefined): string | undefined {
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

function requireEnabledProxy(enabled: boolean, proxyUrl: string | undefined): void {
  if (enabled && !proxyUrl) {
    throw new ApiError(400, "telegram_proxy_required", "启用 Telegram 代理前需要填写代理 URL");
  }
}

function invalidProxy(): ApiError {
  return new ApiError(400, "telegram_proxy_invalid", "代理 URL 必须使用 http、https 或 socks5 协议");
}

function decryptConfiguredProxy(channel: NotificationChannel, vault: SecretVault): string | undefined {
  if (channel.proxyUrl) return channel.proxyUrl;
  return channel.encryptedProxyUrl ? vault.decrypt(channel.encryptedProxyUrl) : undefined;
}

function enabledProxyUrl(channel: NotificationChannel, vault: SecretVault): string | undefined {
  if (channel.proxyEnabled !== true) return undefined;
  const proxyUrl = decryptConfiguredProxy(channel, vault);
  requireEnabledProxy(true, proxyUrl);
  return proxyUrl;
}

function proxyHint(proxyUrl: string): string {
  const parsed = new URL(proxyUrl);
  return `${parsed.protocol}//${parsed.host}`;
}

function tokenHint(token: string): string {
  return token.length <= 4 ? "••••" : `••••${token.slice(-4)}`;
}

function toChannelView(channel: NotificationChannel): NotificationChannelView {
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

function extractTelegramChat(value: unknown): TelegramChat | undefined {
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

function chatLabel(chat: TelegramChat): string {
  return chat.title
    || [chat.firstName, chat.lastName].filter(Boolean).join(" ")
    || (chat.username ? `@${chat.username}` : "")
    || chat.id;
}

function toDeliveryView(delivery: ReportDelivery, data: StoreData): ReportDeliveryView {
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

function formatReportMessage(report: ReportGeneration, publicReportUrl: string): string {
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

function requirePublicReportUrl(report: ReportGeneration, publicBaseUrl?: string): string {
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

function publicErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message.slice(0, MAX_ERROR_LENGTH);
  return "Telegram 请求失败";
}
