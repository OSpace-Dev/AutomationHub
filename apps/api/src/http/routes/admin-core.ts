import { invalidPayload } from "../../errors.js";
import type { RegistrationCode } from "../../models.js";
import type { HttpContext } from "../context.js";
import { pageMeta, readPage, readPageSize, readJson } from "../request.js";
import { writeJson } from "../response.js";
import { serializeDevice } from "./devices.js";
import { requireObject, requireString } from "../../validation.js";

export async function routeAdminCore(context: HttpContext): Promise<boolean> {
  const { request, response, url, service, options } = context;

  if (request.method === "GET" && url.pathname === "/api/v1/admin/runs") {
    const runs = await service.listRuns(url.searchParams.get("date") ?? undefined, readPage(url), readPageSize(url));
    writeJson(response, 200, { status: "success", data: runs.items, meta: pageMeta(runs) }, options.corsOrigin);
    return true;
  }

  const itemsMatch = url.pathname.match(/^\/api\/v1\/admin\/runs\/([^/]+)\/items$/);
  if (request.method === "GET" && itemsMatch) {
    const items = await service.listItems(decodeURIComponent(itemsMatch[1]), readPage(url), readPageSize(url));
    writeJson(response, 200, { status: "success", data: items.items, meta: pageMeta(items) }, options.corsOrigin);
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/v1/admin/devices") {
    const devices = await service.listDevices(readPage(url), readPageSize(url));
    writeJson(response, 200, { status: "success", data: devices.items.map(serializeDevice), meta: pageMeta(devices) }, options.corsOrigin);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/admin/authorizations") {
    const body = requireObject(await readJson(request));
    const result = await service.createRegistrationCode(parseAuthorizationExpiry(requireString(body, "expires_in")));
    writeJson(response, 201, { status: "success", data: { authorization: serializeAuthorization(result.authorization), code: result.code } }, options.corsOrigin);
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/v1/admin/authorizations") {
    const authorizations = await service.listRegistrationCodes(readPage(url), readPageSize(url));
    writeJson(response, 200, { status: "success", data: authorizations.items.map(serializeAuthorization), meta: pageMeta(authorizations) }, options.corsOrigin);
    return true;
  }

  const deleteAuthorizationMatch = url.pathname.match(/^\/api\/v1\/admin\/authorizations\/([^/]+)$/);
  if (request.method === "DELETE" && deleteAuthorizationMatch) {
    const authorization = await service.revokeRegistrationCode(decodeURIComponent(deleteAuthorizationMatch[1]));
    writeJson(response, 200, { status: "success", data: serializeAuthorization(authorization) }, options.corsOrigin);
    return true;
  }

  return false;
}

function serializeAuthorization(authorization: RegistrationCode) {
  const now = Date.now();
  const status = authorization.revokedAt ? "revoked" : authorization.usedAt ? "used" : authorization.expiresAt && new Date(authorization.expiresAt).getTime() <= now ? "expired" : "active";
  return {
    id: authorization.id,
    code_hint: authorization.codeHint ?? "legacy",
    status,
    created_at: authorization.createdAt,
    expires_at: authorization.expiresAt,
    used_at: authorization.usedAt,
    device_id: authorization.deviceId
  };
}

function parseAuthorizationExpiry(value: string): "24h" | "7d" | "30d" | "never" {
  const values = ["24h", "7d", "30d", "never"] as const;
  if (!values.includes(value as (typeof values)[number])) throw invalidPayload("expires_in must be 24h, 7d, 30d, or never");
  return value as (typeof values)[number];
}
