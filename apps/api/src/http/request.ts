import type { IncomingMessage } from "node:http";
import { invalidPayload } from "../errors.js";

export async function readJson(request: IncomingMessage): Promise<unknown> {
  let content = "";
  for await (const chunk of request) content += chunk;
  if (!content) return {};
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw invalidPayload("request body must be valid JSON");
  }
}

export function requireHeader(request: IncomingMessage, name: string): string {
  const value = request.headers[name];
  if (typeof value !== "string" || value.trim() === "") throw invalidPayload(`${name} header is required`);
  return value;
}

export function optionalBoolean(object: Record<string, unknown>, field: string, fallback?: boolean): boolean {
  const value = object[field];
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "boolean") throw invalidPayload(`${field} must be a boolean`);
  return value;
}

export function readPage(url: URL): number {
  const value = Number(url.searchParams.get("page") ?? 1);
  return Number.isFinite(value) ? value : 1;
}

export function readPageSize(url: URL): number {
  const value = Number(url.searchParams.get("page_size") ?? 20);
  return Number.isFinite(value) ? value : 20;
}

export function pageMeta(page: { total: number; page: number; pageSize: number; totalPages: number }) {
  return { total: page.total, page: page.page, page_size: page.pageSize, total_pages: page.totalPages };
}
