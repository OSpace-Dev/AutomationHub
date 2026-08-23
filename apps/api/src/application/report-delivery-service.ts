import { SecretVault, createId } from "../shared/crypto.js";
import { ApiError } from "../shared/errors.js";
import type { NotificationChannel, NotificationTarget } from "../domain/models.js";
import {
  channelNotFound,
  chatLabel,
  decryptConfiguredProxy,
  enabledProxyUrl,
  extractTelegramChat,
  findChannel,
  findTarget,
  optionalProxyUrl,
  proxyHint,
  publicErrorMessage,
  requireEnabledProxy,
  requiredChatId,
  requiredName,
  requiredToken,
  targetNotFound,
  toChannelView,
  toDeliveryView,
  tokenHint,
  type NotificationChannelInput,
  type NotificationChannelView,
  type NotificationTargetInput,
  type ReportDeliveryView,
  type TelegramChatView
} from "./notification-formatters.js";
import type { NotificationPersistencePort } from "./ports/notification-persistence-port.js";
import { TelegramClient, type TelegramChat } from "../infrastructure/notifications/telegram-client.js";
import { NotificationWorker } from "./notification-worker.js";

const MAX_ERROR_LENGTH = 240;
export type {
  NotificationChannelInput,
  NotificationChannelView,
  NotificationTargetInput,
  ReportDeliveryView,
  TelegramChatView
} from "./notification-formatters.js";

export class ReportDeliveryService {
  private readonly worker: NotificationWorker;

  constructor(
    private readonly persistence: NotificationPersistencePort,
    private readonly vault: SecretVault,
    private readonly telegram = new TelegramClient(),
    private readonly publicBaseUrl?: string
  ) {
    this.worker = new NotificationWorker(persistence, vault, telegram, publicBaseUrl);
  }

  async start(): Promise<void> {
    await this.worker.start();
  }

  stop(): void {
    this.worker.stop();
  }

  wake(): void {
    this.worker.wake();
  }

  async listChannels(): Promise<NotificationChannelView[]> {
    const data = await this.persistence.readSnapshot();
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
    return this.persistence.update((data) => {
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
    const data = await this.persistence.readSnapshot();
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
    return this.persistence.update((data) => {
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
    return this.persistence.update((data) => {
      const index = data.notificationChannels.findIndex((entry) => entry.id === id);
      if (index < 0) throw channelNotFound();
      const [channel] = data.notificationChannels.splice(index, 1);
      data.notificationTargets = data.notificationTargets.filter((target) => target.channelId !== id);
      return toChannelView(channel);
    });
  }

  async verifyChannel(id: string): Promise<NotificationChannelView> {
    const data = await this.persistence.readSnapshot();
    const channel = findChannel(data, id);
    try {
      const bot = await this.telegram.getMe(
        this.vault.decrypt(channel.encryptedBotToken),
        enabledProxyUrl(channel, this.vault)
      );
      return this.persistence.update((next) => {
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
    const data = await this.persistence.readSnapshot();
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
    const data = await this.persistence.readSnapshot();
    const channel = findChannel(data, channelId);
    await this.telegram.sendMessage(
      this.vault.decrypt(channel.encryptedBotToken),
      requiredChatId(chatId),
      "AutomationHub 测试消息：连接正常。",
      enabledProxyUrl(channel, this.vault)
    );
  }

  async listTargets(channelId: string): Promise<NotificationTarget[]> {
    const data = await this.persistence.readSnapshot();
    findChannel(data, channelId);
    return data.notificationTargets
      .filter((target) => target.channelId === channelId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((target) => structuredClone(target));
  }

  async createTarget(channelId: string, input: NotificationTargetInput): Promise<NotificationTarget> {
    return this.persistence.update((data) => {
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
    return this.persistence.update((data) => {
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
    return this.persistence.update((data) => {
      findChannel(data, channelId);
      const index = data.notificationTargets.findIndex((target) => target.channelId === channelId && target.id === targetId);
      if (index < 0) throw targetNotFound();
      const [target] = data.notificationTargets.splice(index, 1);
      return structuredClone(target);
    });
  }

  async sendTest(channelId: string, targetId: string): Promise<void> {
    const data = await this.persistence.readSnapshot();
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
    const data = await this.persistence.readSnapshot();
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
    const delivery = await this.persistence.update((data) => {
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
    const data = await this.persistence.readSnapshot();
    return toDeliveryView(delivery, data);
  }

  private async createDeliveries(reportId: string, resendExisting: boolean): Promise<ReportDeliveryView[]> {
    return this.persistence.update((data) => {
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

  private async recordChannelError(id: string, message: string): Promise<void> {
    await this.persistence.update((data) => {
      const channel = data.notificationChannels.find((entry) => entry.id === id);
      if (!channel) return;
      channel.lastError = message.slice(0, MAX_ERROR_LENGTH);
      channel.updatedAt = new Date().toISOString();
    });
  }
}
