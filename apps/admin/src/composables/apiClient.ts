import { ref } from "vue";
import type { ApiResponse, PageMeta } from "../admin-models";

const defaultApiOrigin = import.meta.env.DEV ? "http://localhost:3000" : window.location.origin;
const storedApiOrigin = sessionStorage.getItem("automationhub.apiOrigin");

export const apiOrigin = ref(storedApiOrigin?.trim() || defaultApiOrigin);

export const adminApiKey = ref(sessionStorage.getItem("automationhub.adminApiKey") ?? "");

export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}) {
  return requestJson<T>(path, init);
}

export async function requestJson<T = unknown>(path: string, init: RequestInit = {}, includeAdminKey = true) {
  const response = await fetch(`${apiOrigin.value.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(includeAdminKey && adminApiKey.value ? { "x-admin-key": adminApiKey.value } : {}),
      ...(init.headers ?? {})
    }
  });
  const body = (await response.json()) as ApiResponse<T>;
  if (!response.ok) throw new Error(body.message || body.code || "管理 API 请求失败。");
  return body;
}

export function pagePath(path: string, state: PageMeta) {
  const joiner = path.includes("?") ? "&" : "?";
  return `${path}${joiner}page=${state.page}&page_size=${state.page_size}`;
}
