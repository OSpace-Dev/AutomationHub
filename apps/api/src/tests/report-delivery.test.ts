import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { SecretVault } from "../shared/crypto.js";
import { ReportDeliveryService } from "../application/report-delivery-service.js";
import { FileStore } from "../infrastructure/persistence/file-store.js";
import { TelegramClient } from "../infrastructure/notifications/telegram-client.js";
import { StoreBackedNotificationPersistenceAdapter } from "../infrastructure/persistence/store-backed-notification-persistence-adapter.js";

test("ReportDeliveryService keeps delivery state independent, idempotent, and recoverable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "automation-hub-telegram-"));
  const storePath = join(directory, "store.json");
  const store = new FileStore(storePath);
  let sendMode: "success" | "failed" = "success";
  const sentMessages: string[] = [];
  const proxyUrl = "socks5://delivery-user:delivery-password@127.0.0.1:1080";
  let directRequestCount = 0;
  const telegram = new TelegramClient({
    requestFetch: async () => {
      directRequestCount += 1;
      throw new Error("Direct Telegram request must not be used");
    },
    requestProxy: async (url, init) => {
      if (url.endsWith("/getMe")) {
        return {
          ok: true,
          status: 200,
          body: { ok: true, result: { id: 42, username: "daily_bot", first_name: "Daily Bot" } }
        };
      }
      if (sendMode === "failed") {
        return { ok: false, status: 503, body: { ok: false } };
      }
      const body = JSON.parse(init.body ?? "{}") as { text: string };
      sentMessages.push(body.text);
      return { ok: true, status: 200, body: { ok: true, result: { message_id: sentMessages.length } } };
    }
  });
  const deliveries = new ReportDeliveryService(new StoreBackedNotificationPersistenceAdapter(store), new SecretVault("telegram-test-encryption-key"), telegram, "https://reports.example.test");

  try {
    await store.initialize();
    await store.update((data) => {
      data.reportGenerations.push({
        id: "report-one",
        definitionId: "definition",
        sourceType: "github_trending",
        businessDate: "2026-08-18",
        runId: "run-one",
        trigger: "automatic",
        status: "completed",
        inputItemCount: 1,
        attemptCount: 1,
        content: "今日完成了一份日报。",
        createdAt: "2026-08-18T00:00:00.000Z",
        completedAt: "2026-08-18T00:01:00.000Z",
        shareToken: "share-one"
      });
    });

    const channel = await deliveries.createChannel({
      name: "日报 Bot",
      botToken: "123456:secret-token",
      proxyUrl,
      proxyEnabled: true,
      enabled: true
    });
    const target = await deliveries.createTarget(channel.id, { name: "日报群", chatId: "-100123", enabled: true });
    const first = await deliveries.enqueueForCompletedReport("report-one");
    const repeated = await deliveries.enqueueForCompletedReport("report-one");
    assert.equal(first.length, 1);
    assert.equal(repeated.length, 1);
    assert.equal((await store.read()).reportDeliveries.length, 1);

    await waitFor(async () => (await store.read()).reportDeliveries[0]?.status === "sent");
    const sent = (await deliveries.listDeliveries("report-one"))[0];
    assert.equal(sent?.status, "sent");
    assert.equal(sent?.targetName, target.name);
    assert.equal(sent?.chatId, target.chatId);
    assert.match(sentMessages[0] ?? "", /AutomationHub 日报/);
    assert.match(sentMessages[0] ?? "", /公开阅读：https:\/\/reports\.example\.test\/share\/reports\/share-one/);

    const resent = await deliveries.enqueueManual("report-one");
    assert.equal(resent.length, 1);
    await waitFor(async () => {
      const delivery = (await store.read()).reportDeliveries[0];
      return delivery?.status === "sent" && delivery.attemptCount === 2;
    });
    assert.equal(sentMessages.length, 2);
    assert.equal((await store.read()).reportDeliveries.length, 1);

    sendMode = "failed";
    const failedReport = await store.update((data) => {
      data.reportGenerations.push({
        id: "report-two",
        definitionId: "definition",
        sourceType: "github_trending",
        businessDate: "2026-08-18",
        runId: "run-two",
        trigger: "manual",
        status: "completed",
        inputItemCount: 1,
        attemptCount: 1,
        content: "第二份日报。",
        createdAt: "2026-08-18T00:02:00.000Z",
        completedAt: "2026-08-18T00:03:00.000Z",
        shareToken: "share-two"
      });
      return data.reportGenerations.at(-1)!.id;
    });
    await deliveries.enqueueForCompletedReport(failedReport);
    await waitFor(async () => (await store.read()).reportDeliveries.some((entry) => entry.reportGenerationId === failedReport && entry.status === "failed"));
    const failed = (await deliveries.listDeliveries(failedReport))[0];
    assert.equal(failed?.status, "failed");
    assert.match(failed?.lastError ?? "", /Telegram/);

    sendMode = "success";
    await deliveries.retryDelivery(failed!.id);
    await waitFor(async () => (await store.read()).reportDeliveries.some((entry) => entry.id === failed!.id && entry.status === "sent"));
    assert.equal((await deliveries.listDeliveries(failedReport))[0]?.attemptCount, 2);

    await store.update((data) => {
      const delivery = data.reportDeliveries.find((entry) => entry.reportGenerationId === failedReport);
      if (delivery) {
        delivery.status = "sending";
        delivery.startedAt = "2026-08-18T00:04:00.000Z";
      }
    });
    const recovered = new ReportDeliveryService(new StoreBackedNotificationPersistenceAdapter(store), new SecretVault("telegram-test-encryption-key"), telegram, "https://reports.example.test");
    await recovered.start();
    await waitFor(async () => (await store.read()).reportDeliveries.some((entry) => entry.reportGenerationId === failedReport && entry.status === "sent"));
    recovered.stop();

    const raw = await readFile(storePath, "utf8");
    assert.equal(raw.includes("123456:secret-token"), false);
    assert.equal(raw.includes("delivery-password"), true);
    assert.equal(directRequestCount, 0);
  } finally {
    deliveries.stop();
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("ReportDeliveryService refuses to send a daily report without a public URL", async () => {
  const directory = await mkdtemp(join(tmpdir(), "automation-hub-public-report-url-"));
  const store = new FileStore(join(directory, "store.json"));
  let sendCount = 0;
  const telegram = new TelegramClient({
    requestFetch: async (input) => {
      if (String(input).endsWith("/getMe")) {
        return new Response(JSON.stringify({ ok: true, result: { id: 42, username: "daily_bot" } }), { status: 200 });
      }
      sendCount += 1;
      return new Response(JSON.stringify({ ok: true, result: { message_id: sendCount } }), { status: 200 });
    }
  });
  const deliveries = new ReportDeliveryService(new StoreBackedNotificationPersistenceAdapter(store), new SecretVault("missing-public-url-key"), telegram);

  try {
    await store.initialize();
    await store.update((data) => {
      data.reportGenerations.push({
        id: "report-without-public-base",
        definitionId: "definition",
        sourceType: "github_trending",
        businessDate: "2026-08-20",
        runId: "run-one",
        trigger: "automatic",
        status: "completed",
        inputItemCount: 1,
        attemptCount: 1,
        content: "这条日报不能缺少公开链接。",
        shareToken: "share-required",
        createdAt: "2026-08-20T00:00:00.000Z",
        completedAt: "2026-08-20T00:01:00.000Z"
      });
    });
    const channel = await deliveries.createChannel({
      name: "日报 Bot",
      botToken: "123456:secret-token",
      enabled: true
    });
    await deliveries.createTarget(channel.id, { name: "日报群", chatId: "-100123", enabled: true });

    await deliveries.enqueueForCompletedReport("report-without-public-base");
    await waitFor(async () => (await store.read()).reportDeliveries[0]?.status === "failed");

    const delivery = (await deliveries.listDeliveries("report-without-public-base"))[0];
    assert.match(delivery?.lastError ?? "", /PUBLIC_BASE_URL/);
    assert.equal(sendCount, 0);
  } finally {
    deliveries.stop();
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("ReportDeliveryService validates, stores plainly, retains, disables, and clears channel proxy settings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "automation-hub-proxy-settings-"));
  const storePath = join(directory, "store.json");
  const store = new FileStore(storePath);
  const proxyUrl = "http://proxy-user:proxy-password@[::1]:8080";
  let directRequestCount = 0;
  const proxyRequests: string[] = [];
  const telegram = new TelegramClient({
    requestFetch: async (input) => {
      directRequestCount += 1;
      return new Response(JSON.stringify({
        ok: true,
        result: String(input).endsWith("/getMe")
          ? { id: 99, username: "settings_bot", first_name: "Settings Bot" }
          : { message_id: 1 }
      }), { status: 200 });
    },
    requestProxy: async (url) => {
      proxyRequests.push(url);
      return {
        ok: true,
        status: 200,
        body: {
          ok: true,
          result: url.endsWith("/getMe")
            ? { id: 99, username: "settings_bot", first_name: "Settings Bot" }
            : { message_id: 1 }
        }
      };
    }
  });
  const deliveries = new ReportDeliveryService(new StoreBackedNotificationPersistenceAdapter(store), new SecretVault("telegram-proxy-encryption-key"), telegram);

  try {
    await store.initialize();
    const channel = await deliveries.createChannel({
      name: "代理设置 Bot",
      botToken: "999999:settings-token",
      proxyUrl,
      proxyEnabled: false,
      enabled: true
    });

    assert.equal(channel.proxyConfigured, true);
    assert.equal(channel.proxyEnabled, false);
    assert.equal(channel.proxyUrlHint, "http://[::1]:8080");
    assert.equal(directRequestCount, 1);
    assert.equal(proxyRequests.length, 0);

    const stored = (await store.read()).notificationChannels[0]!;
    assert.equal(stored.proxyUrl, new URL(proxyUrl).toString());
    assert.equal(stored.encryptedProxyUrl, undefined);
    assert.equal(stored.proxyUrlHint, "http://[::1]:8080");
    const raw = await readFile(storePath, "utf8");
    assert.equal(raw.includes("proxy-user"), true);
    assert.equal(raw.includes("proxy-password"), true);

    await assert.rejects(
      () => deliveries.createChannel({
        name: "缺少代理",
        botToken: "999999:settings-token",
        proxyEnabled: true,
        enabled: true
      }),
      (error: unknown) => (error as { code?: string }).code === "telegram_proxy_required"
    );
    await assert.rejects(
      () => deliveries.updateChannel(channel.id, { proxyUrl: "ftp://proxy.example.test:21" }),
      (error: unknown) => (error as { code?: string }).code === "telegram_proxy_invalid"
    );

    const enabled = await deliveries.updateChannel(channel.id, { proxyEnabled: true });
    assert.equal(enabled.proxyEnabled, true);
    assert.equal(proxyRequests.length, 1);

    const target = await deliveries.createTarget(channel.id, {
      name: "代理测试群",
      chatId: "-100999",
      enabled: true
    });
    await deliveries.sendTest(channel.id, target.id);
    assert.equal(proxyRequests.length, 2);

    const disabled = await deliveries.updateChannel(channel.id, { proxyEnabled: false });
    assert.equal(disabled.proxyEnabled, false);
    assert.equal(disabled.proxyConfigured, true);
    assert.equal(directRequestCount, 2);
    assert.equal((await store.read()).notificationChannels[0]?.proxyUrl, new URL(proxyUrl).toString());

    const cleared = await deliveries.updateChannel(channel.id, { proxyUrl: "", proxyEnabled: false });
    assert.equal(cleared.proxyConfigured, false);
    assert.equal(cleared.proxyEnabled, false);
    const clearedStored = (await store.read()).notificationChannels[0]!;
    assert.equal(clearedStored.proxyUrl, undefined);
    assert.equal(clearedStored.encryptedProxyUrl, undefined);
    assert.equal(clearedStored.proxyUrlHint, undefined);
  } finally {
    deliveries.stop();
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("ReportDeliveryService discovers unique Telegram chats and tests an unconfigured chat", async () => {
  const directory = await mkdtemp(join(tmpdir(), "automation-hub-chat-discovery-"));
  const store = new FileStore(join(directory, "store.json"));
  const requestUrls: string[] = [];
  const telegram = new TelegramClient({
    requestProxy: async (url, init) => {
      requestUrls.push(url);
      if (url.endsWith("/getMe")) {
        return {
          ok: true,
          status: 200,
          body: { ok: true, result: { id: 77, username: "discovery_bot", first_name: "Discovery Bot" } }
        };
      }
      if (url.endsWith("/getUpdates")) {
        return {
          ok: true,
          status: 200,
          body: {
            ok: true,
            result: [
              { update_id: 1, message: { chat: { id: 42, type: "private", first_name: "Lin" } } },
              { update_id: 2, edited_message: { chat: { id: 42, type: "private", first_name: "Lin" } } },
              { update_id: 3, channel_post: { chat: { id: -1001, type: "channel", title: "日报频道" } } }
            ]
          }
        };
      }
      return { ok: true, status: 200, body: { ok: true, result: { message_id: 1 } } };
    }
  });
  const deliveries = new ReportDeliveryService(new StoreBackedNotificationPersistenceAdapter(store), new SecretVault("chat-discovery-key"), telegram);

  try {
    await store.initialize();
    const channel = await deliveries.createChannel({
      name: "会话发现 Bot",
      botToken: "999999:discovery-token",
      proxyUrl: "socks5://127.0.0.1:1080",
      proxyEnabled: true,
      enabled: true
    });
    await deliveries.createTarget(channel.id, { name: "已配置私聊", chatId: "42", enabled: true });

    const chats = await deliveries.discoverChats(channel.id);
    assert.deepEqual(chats.map((chat) => ({ id: chat.id, title: chat.title, alreadyConfigured: chat.alreadyConfigured })), [
      { id: "-1001", title: "日报频道", alreadyConfigured: false },
      { id: "42", title: undefined, alreadyConfigured: true }
    ]);
    await deliveries.sendTestChat(channel.id, "-1001");
    assert.deepEqual(requestUrls, [
      "https://api.telegram.org/bot999999:discovery-token/getMe",
      "https://api.telegram.org/bot999999:discovery-token/getUpdates",
      "https://api.telegram.org/bot999999:discovery-token/sendMessage"
    ]);
  } finally {
    deliveries.stop();
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error("Timed out waiting for Telegram delivery state");
}
