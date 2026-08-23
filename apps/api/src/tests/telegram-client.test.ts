import { test } from "node:test";
import assert from "node:assert/strict";
import { TelegramClient } from "../infrastructure/notifications/telegram-client.js";

test("TelegramClient validates bots, sends JSON, splits Unicode text, and redacts failures", async () => {
  const requests: Array<{ url: string; body?: string }> = [];
  const client = new TelegramClient({
    requestFetch: async (input, init) => {
      requests.push({ url: String(input), body: typeof init?.body === "string" ? init.body : undefined });
      if (String(input).endsWith("/getMe")) {
        return new Response(JSON.stringify({ ok: true, result: { id: 42, username: "daily_bot", first_name: "Daily Bot" } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }), { status: 200 });
    }
  });

  const bot = await client.getMe("123456:secret-token");
  await client.sendMessage("123456:secret-token", "-100123", "日报测试");

  assert.deepEqual(bot, { id: 42, username: "daily_bot", firstName: "Daily Bot" });
  assert.equal(requests[0]?.url, "https://api.telegram.org/bot123456:secret-token/getMe");
  assert.equal(requests[1]?.url, "https://api.telegram.org/bot123456:secret-token/sendMessage");
  assert.deepEqual(JSON.parse(requests[1]?.body ?? "{}"), { chat_id: "-100123", text: "日报测试" });

  const parts = TelegramClient.splitText(`${"中".repeat(4_095)}🙂中`);
  assert.equal(parts.length, 2);
  assert.equal(Array.from(parts[0] ?? "").length, 4_096);
  assert.equal(Array.from(parts[1] ?? "").length, 1);

  const failed = new TelegramClient({
    requestFetch: async () => new Response(JSON.stringify({ ok: false, description: "Unauthorized token 123456:secret-token" }), { status: 401 })
  });
  await assert.rejects(() => failed.sendMessage("123456:secret-token", "chat", "text"), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "telegram_send_failed");
    assert.doesNotMatch((error as Error).message, /secret-token/);
    return true;
  });
});

test("TelegramClient routes getMe and sendMessage through a reusable proxy agent without leaking credentials", async () => {
  const proxyUrl = "socks5://proxy-user:proxy-password@127.0.0.1:1080";
  const proxyRequests: Array<{ url: string; body?: string; agent: object }> = [];
  let directRequestCount = 0;
  const client = new TelegramClient({
    requestFetch: async () => {
      directRequestCount += 1;
      throw new Error("Direct request must not be used");
    },
    requestProxy: async (url, init, agent) => {
      proxyRequests.push({ url, body: init.body, agent });
      if (url.endsWith("/getMe")) {
        return {
          ok: true,
          status: 200,
          body: { ok: true, result: { id: 42, username: "proxy_bot", first_name: "Proxy Bot" } }
        };
      }
      return { ok: true, status: 200, body: { ok: true, result: { message_id: 8 } } };
    }
  });

  const bot = await client.getMe("123456:secret-token", proxyUrl);
  await client.sendMessage("123456:secret-token", "-100123", "代理测试", proxyUrl);

  assert.equal(bot.username, "proxy_bot");
  assert.equal(directRequestCount, 0);
  assert.equal(proxyRequests.length, 2);
  assert.equal(proxyRequests[0]?.agent, proxyRequests[1]?.agent);
  assert.deepEqual(JSON.parse(proxyRequests[1]?.body ?? "{}"), { chat_id: "-100123", text: "代理测试" });

  const failed = new TelegramClient({
    requestProxy: async () => {
      throw new Error(`Unable to connect through ${proxyUrl}`);
    }
  });
  await assert.rejects(() => failed.getMe("123456:secret-token", proxyUrl), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "telegram_proxy_failed");
    assert.doesNotMatch((error as Error).message, /proxy-user|proxy-password|127\.0\.0\.1/);
    return true;
  });

  client.close();
  failed.close();
});

test("TelegramClient reads updates through the configured proxy", async () => {
  const requests: Array<{ url: string; body?: string }> = [];
  const client = new TelegramClient({
    requestProxy: async (url, init) => {
      requests.push({ url, body: init.body });
      return {
        ok: true,
        status: 200,
        body: {
          ok: true,
          result: [
            { update_id: 1, message: { chat: { id: 42, type: "private", first_name: "Lin" } } },
            { update_id: 2, channel_post: { chat: { id: -1001, type: "channel", title: "日报频道" } } }
          ]
        }
      };
    }
  });

  const updates = await client.getUpdates("123456:secret-token", "http://proxy.example.test:8080");

  assert.equal(requests[0]?.url, "https://api.telegram.org/bot123456:secret-token/getUpdates");
  assert.deepEqual(JSON.parse(requests[0]?.body ?? "{}"), {
    limit: 100,
    timeout: 0,
    allowed_updates: [
      "message",
      "edited_message",
      "channel_post",
      "edited_channel_post",
      "business_message",
      "edited_business_message",
      "my_chat_member",
      "chat_member",
      "chat_join_request"
    ]
  });
  assert.equal(updates.length, 2);
  client.close();
});
