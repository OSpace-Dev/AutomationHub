import { ApiKeyVault, createId } from "../shared/crypto.js";
import { ApiError, invalidPayload } from "../shared/errors.js";
import type { ModelProvider, ReportDefinition, StoreData } from "../domain/models.js";
import type { Store } from "./ports/store.js";

const MODEL_LIST_TIMEOUT_MS = 20_000;
const REPORT_TIMEOUT_MS = 120_000;
const REPORT_MAX_OUTPUT_TOKENS = 2_400;
const DEFAULT_REPORT_PROMPT = "请根据给定的 GitHub Trending 项目资料逐项目分析用途和值得关注原因。不要编造输入中没有的事实。";

export interface ModelProviderInput {
  name: string;
  baseUrl: string;
  apiKey?: string;
  selectedModel: string;
  isDefault: boolean;
}

export interface ModelProviderView extends Omit<ModelProvider, "encryptedApiKey"> {
  apiKeyConfigured: boolean;
  apiKeyHint: string;
}

export interface ModelDescriptor {
  id: string;
  name?: string;
}

export function normalizeModelBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim().replace(/\/+$/, ""));
  } catch {
    throw new ApiError(400, "invalid_model_base_url", "Base URL must be a valid HTTP or HTTPS URL");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new ApiError(400, "invalid_model_base_url", "Base URL must not contain credentials, query parameters, or fragments");
  }
  return url.toString().replace(/\/+$/, "");
}

export function apiKeyHint(apiKey: string): string {
  return apiKey.length <= 4 ? "••••" : `••••${apiKey.slice(-4)}`;
}

export class OpenAiCompatibleClient {
  constructor(private readonly requestFetch: typeof fetch = fetch) {}

  async listModels(baseUrl: string, apiKey: string): Promise<ModelDescriptor[]> {
    const body = await this.request(
      baseUrl,
      apiKey,
      "/models",
      MODEL_LIST_TIMEOUT_MS,
      (response) => readJson(response, "model_list_failed")
    );
    const models: unknown[] = Array.isArray(body?.data) ? body.data : [];
    const result: ModelDescriptor[] = [];
    for (const entry of models) {
      if (typeof entry !== "object" || entry === null || typeof (entry as { id?: unknown }).id !== "string") continue;
      const model = entry as { id: string; name?: unknown };
      result.push({ id: model.id, name: typeof model.name === "string" ? model.name : undefined });
    }
    if (!result.length) throw new ApiError(502, "model_list_failed", "Model service returned no usable models", true);
    return result;
  }

  async createChatCompletion(baseUrl: string, apiKey: string, model: string, messages: Array<{ role: "system" | "user"; content: string }>): Promise<string> {
    return this.request(
      baseUrl,
      apiKey,
      "/chat/completions",
      REPORT_TIMEOUT_MS,
      readChatCompletion,
      {
        method: "POST",
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.2,
          max_tokens: REPORT_MAX_OUTPUT_TOKENS,
          stream: true
        })
      }
    );
  }

  private async request<T>(
    baseUrl: string,
    apiKey: string,
    path: string,
    timeoutMs: number,
    consume: (response: Response) => Promise<T>,
    init: RequestInit = {}
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    try {
      const response = await this.requestFetch(`${baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          ...(init.headers ?? {})
        }
      });
      if (!response.ok) {
        const message = await safePublicError(response, apiKey);
        throw new ApiError(502, path === "/models" ? "model_list_failed" : "report_generation_failed", message, true);
      }
      return await consume(response);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new ApiError(504, path === "/models" ? "model_list_failed" : "report_generation_failed", "Model service request timed out", true);
      }
      throw new ApiError(502, path === "/models" ? "model_list_failed" : "report_generation_failed", "Model service request failed", true);
    } finally {
      clearTimeout(timer);
    }
  }
}

export class ModelProviderService {
  constructor(
    private readonly store: Store,
    private readonly vault: ApiKeyVault,
    private readonly client = new OpenAiCompatibleClient()
  ) {}

  async list(): Promise<ModelProviderView[]> {
    const data = await this.store.read();
    return data.modelProviders
      .slice()
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b.updatedAt.localeCompare(a.updatedAt))
      .map(toProviderView);
  }

  async create(input: ModelProviderInput): Promise<ModelProviderView> {
    const name = requiredName(input.name, "name");
    const baseUrl = normalizeModelBaseUrl(input.baseUrl);
    const apiKey = requiredApiKey(input.apiKey);
    const selectedModel = requiredModel(input.selectedModel);
    return this.store.update((data) => {
      const now = new Date().toISOString();
      const provider: ModelProvider = {
        id: createId(),
        name,
        baseUrl,
        encryptedApiKey: this.vault.encrypt(apiKey),
        apiKeyHint: apiKeyHint(apiKey),
        selectedModel,
        isDefault: input.isDefault || data.modelProviders.length === 0,
        status: "active",
        createdAt: now,
        updatedAt: now
      };
      data.modelProviders.push(provider);
      if (provider.isDefault) this.unsetOtherDefaults(data, provider.id);
      this.ensureDefaultDefinition(data, provider);
      return toProviderView(provider);
    });
  }

  async update(id: string, input: Partial<ModelProviderInput>): Promise<ModelProviderView> {
    return this.store.update((data) => {
      const provider = data.modelProviders.find((entry) => entry.id === id);
      if (!provider) throw new ApiError(404, "model_provider_not_found", "Model provider was not found");
      if (input.name !== undefined) provider.name = requiredName(input.name, "name");
      if (input.baseUrl !== undefined) provider.baseUrl = normalizeModelBaseUrl(input.baseUrl);
      if (input.selectedModel !== undefined) provider.selectedModel = requiredModel(input.selectedModel);
      if (input.apiKey?.trim()) {
        provider.encryptedApiKey = this.vault.encrypt(input.apiKey.trim());
        provider.apiKeyHint = apiKeyHint(input.apiKey.trim());
      }
      if (input.isDefault !== undefined) provider.isDefault = input.isDefault;
      provider.updatedAt = new Date().toISOString();
      if (provider.isDefault) this.unsetOtherDefaults(data, provider.id);
      if (provider.isDefault) this.ensureDefaultDefinition(data, provider);
      return toProviderView(provider);
    });
  }

  async remove(id: string): Promise<ModelProviderView> {
    return this.store.update((data) => {
      const index = data.modelProviders.findIndex((entry) => entry.id === id);
      if (index < 0) throw new ApiError(404, "model_provider_not_found", "Model provider was not found");
      const [provider] = data.modelProviders.splice(index, 1);
      for (const definition of data.reportDefinitions) {
        if (definition.providerId === id) {
          definition.enabled = false;
          definition.providerId = undefined;
          definition.updatedAt = new Date().toISOString();
        }
      }
      return toProviderView(provider);
    });
  }

  async fetchModels(input: { providerId?: string; baseUrl?: string; apiKey?: string }): Promise<ModelDescriptor[]> {
    let baseUrl = input.baseUrl;
    let apiKey = input.apiKey;
    if (input.providerId) {
      const data = await this.store.read();
      const provider = data.modelProviders.find((entry) => entry.id === input.providerId);
      if (!provider) throw new ApiError(404, "model_provider_not_found", "Model provider was not found");
      baseUrl = baseUrl?.trim() || provider.baseUrl;
      apiKey = apiKey?.trim() || this.vault.decrypt(provider.encryptedApiKey);
    }
    if (!baseUrl) throw invalidPayload("base_url is required");
    if (!apiKey?.trim()) throw new ApiError(400, "model_api_key_required", "API Key is required");
    const normalized = normalizeModelBaseUrl(baseUrl);
    try {
      const models = await this.client.listModels(normalized, apiKey.trim());
      if (input.providerId) {
        await this.store.update((data) => {
          const provider = data.modelProviders.find((entry) => entry.id === input.providerId);
          if (provider) {
            provider.lastModelsFetchedAt = new Date().toISOString();
            provider.lastError = undefined;
          }
        });
      }
      return models;
    } catch (error) {
      if (input.providerId) {
        await this.store.update((data) => {
          const provider = data.modelProviders.find((entry) => entry.id === input.providerId);
          if (provider) {
            provider.lastError = publicErrorMessage(error);
            provider.updatedAt = new Date().toISOString();
          }
        });
      }
      throw error;
    }
  }

  async getDefault(): Promise<{ provider: ModelProvider; definition: ReportDefinition } | null> {
    const data = await this.store.read();
    const provider = data.modelProviders.find((entry) => entry.isDefault && entry.status === "active");
    const definition = data.reportDefinitions.find((entry) => entry.enabled && entry.sourceType === "github_trending" && entry.providerId === provider?.id);
    return provider && definition ? { provider, definition } : null;
  }

  decryptApiKey(provider: ModelProvider): string {
    return this.vault.decrypt(provider.encryptedApiKey);
  }

  get clientInstance(): OpenAiCompatibleClient {
    return this.client;
  }

  private unsetOtherDefaults(data: StoreData, providerId: string): void {
    for (const provider of data.modelProviders) if (provider.id !== providerId) provider.isDefault = false;
  }

  private ensureDefaultDefinition(data: StoreData, provider: ModelProvider): void {
    let definition = data.reportDefinitions.find((entry) => entry.sourceType === "github_trending");
    const now = new Date().toISOString();
    if (!definition) {
      definition = {
        id: createId(),
        type: "daily_report",
        name: "GitHub Trending 日报",
        sourceType: "github_trending",
        providerId: provider.id,
        promptTemplate: DEFAULT_REPORT_PROMPT,
        enabled: true,
        createdAt: now,
        updatedAt: now
      };
      data.reportDefinitions.push(definition);
    } else {
      definition.providerId = provider.id;
      definition.enabled = true;
      definition.updatedAt = now;
    }
  }
}

function toProviderView(provider: ModelProvider): ModelProviderView {
  const { encryptedApiKey: _encryptedApiKey, ...view } = structuredClone(provider);
  return { ...view, apiKeyConfigured: Boolean(provider.encryptedApiKey), apiKeyHint: provider.apiKeyHint };
}

function requiredName(value: string | undefined, field: string): string {
  if (!value?.trim()) throw invalidPayload(`${field} must be a non-empty string`);
  return value.trim();
}

function requiredApiKey(value: string | undefined): string {
  if (!value?.trim()) throw new ApiError(400, "model_api_key_required", "API Key is required");
  return value.trim();
}

function requiredModel(value: string | undefined): string {
  if (!value?.trim()) throw invalidPayload("selected_model must be a non-empty string");
  return value.trim();
}

async function readJson(response: Response, errorCode: "model_list_failed" | "report_generation_failed"): Promise<any> {
  try {
    return await response.json();
  } catch {
    throw new ApiError(502, errorCode, "Model service returned invalid JSON", true);
  }
}

async function readChatCompletion(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("text/event-stream")) return readStreamingChatCompletion(response);
  const body = await readJson(response, "report_generation_failed");
  return extractChatContent(body);
}

async function readStreamingChatCompletion(response: Response): Promise<string> {
  if (!response.body) throw new ApiError(502, "report_generation_failed", "Model service returned no response stream", true);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const consumed = consumeSseEvents(buffer);
      buffer = consumed.remainder;
      content += consumed.content;
      if (done) break;
    }
    if (buffer.trim()) content += parseSseEvent(buffer);
    if (!content.trim()) throw new ApiError(502, "report_generation_failed", "Model service returned no report content", true);
    return content.trim();
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // The upstream may already have closed the stream.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function consumeSseEvents(value: string): { content: string; remainder: string } {
  let remainder = value;
  let content = "";
  while (true) {
    const separator = /\r?\n\r?\n/.exec(remainder);
    if (!separator) break;
    content += parseSseEvent(remainder.slice(0, separator.index));
    remainder = remainder.slice(separator.index + separator[0].length);
  }
  return { content, remainder };
}

function parseSseEvent(event: string): string {
  const data = event
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
  if (!data || data === "[DONE]") return "";
  try {
    const body = JSON.parse(data);
    const content = body?.choices?.[0]?.delta?.content ?? body?.choices?.[0]?.message?.content;
    return typeof content === "string" ? content : "";
  } catch {
    throw new ApiError(502, "report_generation_failed", "Model service returned invalid stream data", true);
  }
}

function extractChatContent(body: any): string {
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new ApiError(502, "report_generation_failed", "Model service returned no report content", true);
  }
  return content.trim();
}

async function safePublicError(response: Response, apiKey: string): Promise<string> {
  try {
    const body = await response.json() as { error?: { message?: unknown }; message?: unknown };
    const message = typeof body?.error?.message === "string" ? body.error.message : typeof body?.message === "string" ? body.message : "";
    return redactSecret(message.trim(), apiKey).slice(0, 240) || `Model service returned HTTP ${response.status}`;
  } catch {
    return `Model service returned HTTP ${response.status}`;
  }
}

function redactSecret(value: string, secret: string): string {
  return secret ? value.replaceAll(secret, "[redacted]") : value;
}

function publicErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Model service request failed";
}
