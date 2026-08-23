import { requireAdmin, isAuthEnabled } from "./auth.js";
import type { HttpContext } from "./context.js";
import { serveAdmin, writeJson } from "./response.js";
import type { ReportInsights } from "../domain/models.js";
import { serializeReportInsights } from "./serializers.js";

export async function routeCore(context: HttpContext): Promise<boolean> {
  const { request, response, url, options, reports } = context;

  if (request.method === "GET" && url.pathname === "/health") {
    writeJson(response, 200, { status: "ok", service: "automation-hub-api" }, options.corsOrigin);
    return true;
  }

  const publicReportMatch = url.pathname.match(/^\/api\/v1\/public\/reports\/([^/]+)$/);
  if (request.method === "GET" && publicReportMatch) {
    const report = await reports.getPublic(decodeURIComponent(publicReportMatch[1]));
    writeJson(response, 200, { status: "success", data: serializePublicReport(report) }, options.corsOrigin);
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/v1/admin/auth-status") {
    writeJson(response, 200, {
      status: "success",
      data: { auth_enabled: isAuthEnabled(options), key_configured: Boolean(options.adminApiKey) }
    }, options.corsOrigin);
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/v1/admin/session") {
    if (context.auth?.type !== "admin") context.auth = requireAdmin(request, options);
    writeJson(response, 200, { status: "success", data: { authenticated: true } }, options.corsOrigin);
    return true;
  }

  if (request.method === "GET" && options.adminDistPath && !url.pathname.startsWith("/api/")) {
    await serveAdmin(response, options.adminDistPath, url.pathname);
    return true;
  }

  return false;
}

function serializePublicReport(report: { businessDate: string; sourceType: string; content: string; insights?: ReportInsights; completedAt?: string }) {
  return {
    business_date: report.businessDate,
    source_type: report.sourceType,
    content: report.content,
    insights: report.insights ? serializeReportInsights(report.insights) : undefined,
    completed_at: report.completedAt
  };
}
