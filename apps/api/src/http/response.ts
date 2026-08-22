import { readFile, stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { ApiError } from "../errors.js";

export function writeJson(response: ServerResponse, statusCode: number, payload: unknown, corsOrigin: string): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": corsOrigin,
    "access-control-allow-headers": "content-type, authorization, idempotency-key, x-admin-key, x-device-id",
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS"
  });
  response.end(statusCode === 204 ? undefined : JSON.stringify(payload));
}

export function handleError(response: ServerResponse, error: unknown, corsOrigin: string): void {
  if (error instanceof ApiError) {
    writeJson(response, error.statusCode, { status: "error", code: error.code, message: error.message, retryable: error.retryable }, corsOrigin);
    return;
  }
  console.error("Unhandled API error", error);
  writeJson(response, 500, { status: "error", code: "internal_error", message: "Internal server error", retryable: true }, corsOrigin);
}

export async function serveAdmin(response: ServerResponse, rootPath: string, pathname: string): Promise<void> {
  const root = resolve(rootPath);
  const requestedPath = resolve(root, `.${decodeURIComponent(pathname)}`);
  const safePath = requestedPath === root || requestedPath.startsWith(`${root}${sep}`) ? requestedPath : resolve(root, "index.html");
  let filePath = safePath;
  try {
    if (!(await stat(filePath)).isFile()) filePath = resolve(root, "index.html");
  } catch {
    filePath = resolve(root, "index.html");
  }
  try {
    const content = await readFile(filePath);
    response.writeHead(200, { "content-type": contentType(filePath), "cache-control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable" });
    response.end(content);
  } catch {
    throw new ApiError(404, "admin_not_built", "Admin application is not available");
  }
}

function contentType(filePath: string): string {
  return ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" } as Record<string, string>)[extname(filePath)] ?? "application/octet-stream";
}
