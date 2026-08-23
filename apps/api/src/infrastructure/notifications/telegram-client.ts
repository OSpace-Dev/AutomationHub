import { request as httpRequest, type Agent } from "node:http";
import { request as httpsRequest } from "node:https";
import { ProxyAgent } from "proxy-agent";
import { ApiError } from "../../shared/errors.js";

const TELEGRAM_TIMEOUT_MS = 15_000;
const TELEGRAM_MAX_TEXT_LENGTH = 4_096;

export interface TelegramBotInfo {
  id: number;
  username?: string;
  firstName?: string;
}

export interface TelegramChat {
  id: string;
  type: string;
  title?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
}

interface TelegramUpdate {
  [key: string]: unknown;
}

export interface TelegramClientOptions {
  requestFetch?: typeof fetch;
  requestProxy?: TelegramProxyRequest;
  timeoutMs?: number;
}

export interface TelegramProxyRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export interface TelegramProxyResponse {
  ok: boolean;
  status: number;
  body: { ok?: boolean; result?: unknown; description?: string };
}

export type TelegramProxyRequest = (
  url: string,
  init: TelegramProxyRequestInit,
  agent: Agent
) => Promise<TelegramProxyResponse>;

export class TelegramClient {
  private readonly requestFetch: typeof fetch;
  private readonly requestProxy: TelegramProxyRequest;
  private readonly timeoutMs: number;
  private readonly proxyAgents = new Map<string, ProxyAgent>();

  constructor(options: TelegramClientOptions = {}) {
    this.requestFetch = options.requestFetch ?? fetch;
    this.requestProxy = options.requestProxy ?? requestViaProxy;
    this.timeoutMs = options.timeoutMs ?? TELEGRAM_TIMEOUT_MS;
  }

  async getMe(token: string, proxyUrl?: string): Promise<TelegramBotInfo> {
    const body = await this.request(token, "getMe", {}, proxyUrl);
    const result = body.result;
    if (!result || typeof result !== "object" || typeof (result as { id?: unknown }).id !== "number") {
      throw new ApiError(422, "telegram_token_invalid", "Telegram Bot Token 验证失败");
    }
    const bot = result as { id: number; username?: unknown; first_name?: unknown };
    return {
      id: bot.id,
      username: typeof bot.username === "string" ? bot.username : undefined,
      firstName: typeof bot.first_name === "string" ? bot.first_name : undefined
    };
  }

  async sendMessage(token: string, chatId: string, text: string, proxyUrl?: string): Promise<void> {
    await this.request(token, "sendMessage", {
      method: "POST",
      body: JSON.stringify({ chat_id: chatId, text })
    }, proxyUrl);
  }

  async getUpdates(token: string, proxyUrl?: string): Promise<TelegramUpdate[]> {
    const body = await this.request(token, "getUpdates", {
      method: "POST",
      body: JSON.stringify({
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
      })
    }, proxyUrl);
    return Array.isArray(body.result)
      ? body.result.filter((update): update is TelegramUpdate => Boolean(update && typeof update === "object"))
      : [];
  }

  close(): void {
    for (const agent of this.proxyAgents.values()) agent.destroy();
    this.proxyAgents.clear();
  }

  static splitText(text: string): string[] {
    const normalized = text.trim();
    if (!normalized) return [""];
    const characters = Array.from(normalized);
    const parts: string[] = [];
    for (let offset = 0; offset < characters.length; offset += TELEGRAM_MAX_TEXT_LENGTH) {
      parts.push(characters.slice(offset, offset + TELEGRAM_MAX_TEXT_LENGTH).join(""));
    }
    return parts;
  }

  private async request(
    token: string,
    method: "getMe" | "getUpdates" | "sendMessage",
    init: RequestInit = {},
    proxyUrl?: string
  ): Promise<{ result?: unknown; description?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    timer.unref?.();
    try {
      const url = `https://api.telegram.org/bot${token}/${method}`;
      const requestInit: TelegramProxyRequestInit = {
        method: init.method,
        body: typeof init.body === "string" ? init.body : undefined,
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        }
      };
      const response = proxyUrl
        ? await this.requestProxy(url, requestInit, this.getProxyAgent(proxyUrl))
        : await this.requestFetch(url, requestInit).then(async (result) => ({
          ok: result.ok,
          status: result.status,
          body: await readJson(result)
        }));
      if (!response.ok || response.body.ok !== true) {
        if (method === "getMe") {
          throw new ApiError(422, "telegram_token_invalid", "Telegram Bot Token 验证失败");
        }
        if (method === "getUpdates" && response.body.description?.toLowerCase().includes("webhook")) {
          throw new ApiError(409, "telegram_updates_unavailable", "Telegram Bot 当前启用了 webhook，暂时无法读取会话。请先删除 webhook 后重试。");
        }
        if (method === "getUpdates") {
          throw new ApiError(502, "telegram_updates_failed", "Telegram 会话读取失败", true);
        }
        throw new ApiError(502, "telegram_send_failed", "Telegram 消息发送失败", true);
      }
      return response.body;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw proxyError(method, "Telegram 代理请求超时", proxyUrl);
      }
      throw proxyError(method, proxyUrl ? "Telegram 代理请求失败" : "Telegram 服务请求失败", proxyUrl);
    } finally {
      clearTimeout(timer);
    }
  }

  private getProxyAgent(proxyUrl: string): ProxyAgent {
    const cached = this.proxyAgents.get(proxyUrl);
    if (cached) return cached;
    const agent = new ProxyAgent({ getProxyForUrl: () => proxyUrl });
    this.proxyAgents.set(proxyUrl, agent);
    return agent;
  }
}

async function readJson(response: Response): Promise<{ ok?: boolean; result?: unknown; description?: string }> {
  try {
    const body = await response.json() as unknown;
    return body && typeof body === "object" ? body as { ok?: boolean; result?: unknown; description?: string } : {};
  } catch {
    return {};
  }
}

function proxyError(method: "getMe" | "getUpdates" | "sendMessage", message: string, proxyUrl?: string): ApiError {
  if (proxyUrl) return new ApiError(502, "telegram_proxy_failed", message, true);
  return new ApiError(
    502,
    method === "getMe" ? "telegram_token_invalid" : method === "getUpdates" ? "telegram_updates_failed" : "telegram_send_failed",
    message,
    true
  );
}

async function requestViaProxy(url: string, init: TelegramProxyRequestInit, agent: Agent): Promise<TelegramProxyResponse> {
  const target = new URL(url);
  const requestFunction = target.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const request = requestFunction(target, {
      method: init.method ?? "GET",
      headers: init.headers,
      agent,
      signal: init.signal
    }, (response) => {
      let content = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { content += chunk; });
      response.on("end", () => {
        let body: { ok?: boolean; result?: unknown; description?: string } = {};
        try {
          const parsed = JSON.parse(content) as unknown;
          if (parsed && typeof parsed === "object") body = parsed as { ok?: boolean; result?: unknown; description?: string };
        } catch {
          body = {};
        }
        resolve({
          ok: (response.statusCode ?? 500) >= 200 && (response.statusCode ?? 500) < 300,
          status: response.statusCode ?? 500,
          body
        });
      });
      response.on("error", reject);
    });
    request.on("error", reject);
    if (init.body) request.write(init.body);
    request.end();
  });
}
