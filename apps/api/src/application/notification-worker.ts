import { ApiError } from "../errors.js";
import type { ReportDelivery } from "../models.js";
import type { SecretVault } from "../crypto.js";
import type { Store } from "../store.js";
import { TelegramClient } from "../telegram-service.js";
import {
  enabledProxyUrl,
  formatReportMessage,
  publicErrorMessage,
  requirePublicReportUrl
} from "./notification-formatters.js";

export class NotificationWorker {
  private processing = false;
  private stopped = false;
  private wakeTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly store: Store,
    private readonly vault: SecretVault,
    private readonly telegram: TelegramClient,
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
}
