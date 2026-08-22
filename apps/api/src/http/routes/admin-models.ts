import type { HttpContext } from "../context.js";
import { optionalBoolean, readJson } from "../request.js";
import { writeJson } from "../response.js";
import { optionalString, requireObject, requireString } from "../../validation.js";

export async function routeAdminModels(context: HttpContext): Promise<boolean> {
  const { request, response, url, providers, options } = context;

  if (request.method === "GET" && url.pathname === "/api/v1/admin/model-providers") {
    const modelProviders = await providers.list();
    writeJson(response, 200, { status: "success", data: modelProviders.map(serializeModelProvider) }, options.corsOrigin);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/admin/model-providers") {
    const body = requireObject(await readJson(request));
    const provider = await providers.create({
      name: requireString(body, "name"),
      baseUrl: requireString(body, "base_url"),
      apiKey: requireString(body, "api_key"),
      selectedModel: requireString(body, "selected_model"),
      isDefault: optionalBoolean(body, "is_default", true)
    });
    writeJson(response, 201, { status: "success", data: serializeModelProvider(provider) }, options.corsOrigin);
    return true;
  }

  const modelProviderMatch = url.pathname.match(/^\/api\/v1\/admin\/model-providers\/([^/:]+)$/);
  if (request.method === "PUT" && modelProviderMatch) {
    const body = requireObject(await readJson(request));
    const provider = await providers.update(decodeURIComponent(modelProviderMatch[1]), {
      name: body.name === undefined ? undefined : requireString(body, "name"),
      baseUrl: body.base_url === undefined ? undefined : requireString(body, "base_url"),
      apiKey: body.api_key === undefined ? undefined : optionalString(body, "api_key") || undefined,
      selectedModel: body.selected_model === undefined ? undefined : requireString(body, "selected_model"),
      isDefault: body.is_default === undefined ? undefined : optionalBoolean(body, "is_default")
    });
    writeJson(response, 200, { status: "success", data: serializeModelProvider(provider) }, options.corsOrigin);
    return true;
  }

  if (request.method === "DELETE" && modelProviderMatch) {
    const provider = await providers.remove(decodeURIComponent(modelProviderMatch[1]));
    writeJson(response, 200, { status: "success", data: serializeModelProvider(provider) }, options.corsOrigin);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/admin/model-providers/models:fetch") {
    const body = requireObject(await readJson(request));
    const models = await providers.fetchModels({
      providerId: optionalString(body, "provider_id") || undefined,
      baseUrl: optionalString(body, "base_url") || undefined,
      apiKey: optionalString(body, "api_key") || undefined
    });
    writeJson(response, 200, { status: "success", data: models }, options.corsOrigin);
    return true;
  }

  return false;
}

function serializeModelProvider(provider: { id: string; name: string; baseUrl: string; apiKeyConfigured: boolean; apiKeyHint: string; selectedModel: string; isDefault: boolean; status: string; lastModelsFetchedAt?: string; lastError?: string; createdAt: string; updatedAt: string }) {
  return {
    id: provider.id,
    name: provider.name,
    base_url: provider.baseUrl,
    api_key_configured: provider.apiKeyConfigured,
    api_key_hint: provider.apiKeyHint,
    selected_model: provider.selectedModel,
    is_default: provider.isDefault,
    status: provider.status,
    last_models_fetched_at: provider.lastModelsFetchedAt,
    last_error: provider.lastError,
    created_at: provider.createdAt,
    updated_at: provider.updatedAt
  };
}
