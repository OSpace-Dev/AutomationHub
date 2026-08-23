import { invalidPayload } from "../../shared/errors.js";
import type { HttpContext } from "../context.js";
import { readJson, requireHeader } from "../request.js";
import { writeJson } from "../response.js";
import type { ProjectSnapshot } from "../../domain/models.js";
import { optionalNonNegativeInteger, requireInteger, requireObject, requireString } from "../../shared/validation.js";
import { optionalString } from "../../shared/validation.js";

export async function routeCollection(context: HttpContext): Promise<boolean> {
  const { request, response, url, service, options, auth } = context;

  if (request.method === "POST" && url.pathname === "/api/v1/collection-runs") {
    if (auth?.type !== "device") throw new Error("Device authentication context is missing");
    const device = auth.device;
    const body = requireObject(await readJson(request));
    const filtersValue = body.filters === undefined ? {} : requireObject(body.filters, "filters");
    const filters = Object.fromEntries(Object.entries(filtersValue).map(([key, value]) => [key, String(value)]));
    const result = await service.createRun(device.id, {
      businessDate: requireString(body, "business_date"),
      sourceUrl: requireString(body, "source_url"),
      filters,
      idempotencyKey: requireHeader(request, "idempotency-key")
    });
    writeJson(response, result.created ? 201 : 200, { status: "success", data: result.run, meta: { created: result.created } }, options.corsOrigin);
    return true;
  }

  const batchMatch = url.pathname.match(/^\/api\/v1\/collection-runs\/([^/]+)\/items:batch$/);
  if (request.method === "POST" && batchMatch) {
    if (auth?.type !== "device") throw new Error("Device authentication context is missing");
    const device = auth.device;
    const body = requireObject(await readJson(request));
    if (!Array.isArray(body.items)) throw invalidPayload("items must be an array");
    const items = body.items.map(parseSnapshotInput);
    const result = await service.uploadItems(device.id, decodeURIComponent(batchMatch[1]), items);
    writeJson(response, 200, { status: "success", data: { ...result, rejected: 0 } }, options.corsOrigin);
    return true;
  }

  return false;
}

export function parseSnapshotInput(value: unknown): Omit<ProjectSnapshot, "id" | "runId" | "normalizedProjectUrl" | "contentHash"> {
  const item = requireObject(value, "item");
  const status = requireString(item, "status");
  if (status !== "success" && status !== "failed") throw invalidPayload("status must be success or failed");
  return {
    projectUrl: requireString(item, "project_url"),
    rank: requireInteger(item, "rank"),
    name: requireString(item, "name"),
    description: optionalString(item, "description") || undefined,
    language: optionalString(item, "language") || undefined,
    totalStars: optionalNonNegativeInteger(item, "total_stars"),
    starsToday: optionalNonNegativeInteger(item, "stars_today"),
    readmeHtml: optionalString(item, "readme_html"),
    readmeText: optionalString(item, "readme_text"),
    readAt: requireString(item, "read_at"),
    status,
    errorCode: optionalString(item, "error_code") || undefined
  };
}
