import { invalidPayload } from "../../errors.js";
import type { ReportGeneration, ReportGenerationStatus, ReportGenerationTrigger } from "../../models.js";
import type { HttpContext } from "../context.js";
import { pageMeta, readJson, readPage, readPageSize } from "../request.js";
import { writeJson } from "../response.js";
import { serializeReportInsights } from "../serializers.js";
import { requireObject, requireString } from "../../validation.js";

export async function routeAdminReports(context: HttpContext): Promise<boolean> {
  const { request, response, url, reports, deliveries, options } = context;

  if (request.method === "GET" && url.pathname === "/api/v1/admin/reports") {
    const result = await reports.list({ date: url.searchParams.get("date") ?? undefined, status: url.searchParams.get("status") ? parseReportStatus(url.searchParams.get("status") as string) : undefined, trigger: url.searchParams.get("trigger") ? parseReportTrigger(url.searchParams.get("trigger") as string) : undefined, page: readPage(url), pageSize: readPageSize(url) });
    writeJson(response, 200, { status: "success", data: result.items.map((report) => serializeReportSummary(report, options.publicBaseUrl)), meta: pageMeta(result) }, options.corsOrigin);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/admin/reports") {
    const body = requireObject(await readJson(request));
    const generation = await reports.createManual(requireString(body, "run_id"));
    writeJson(response, 202, { status: "success", data: serializeReport(generation, options.publicBaseUrl) }, options.corsOrigin);
    return true;
  }

  const reportDeliveriesMatch = url.pathname.match(/^\/api\/v1\/admin\/reports\/([^/]+)\/deliveries$/);
  if (request.method === "GET" && reportDeliveriesMatch) {
    const reportDeliveries = await deliveries.listDeliveries(decodeURIComponent(reportDeliveriesMatch[1]));
    writeJson(response, 200, { status: "success", data: reportDeliveries.map(serializeReportDelivery) }, options.corsOrigin);
    return true;
  }
  if (request.method === "POST" && reportDeliveriesMatch) {
    const reportDeliveries = await deliveries.enqueueManual(decodeURIComponent(reportDeliveriesMatch[1]));
    writeJson(response, 202, { status: "success", data: reportDeliveries.map(serializeReportDelivery) }, options.corsOrigin);
    return true;
  }

  const reportDeliveryRetryMatch = url.pathname.match(/^\/api\/v1\/admin\/report-deliveries\/([^/:]+):retry$/);
  if (request.method === "POST" && reportDeliveryRetryMatch) {
    const delivery = await deliveries.retryDelivery(decodeURIComponent(reportDeliveryRetryMatch[1]));
    writeJson(response, 202, { status: "success", data: serializeReportDelivery(delivery) }, options.corsOrigin);
    return true;
  }

  const reportRetryMatch = url.pathname.match(/^\/api\/v1\/admin\/reports\/([^/:]+):retry$/);
  if (request.method === "POST" && reportRetryMatch) {
    const generation = await reports.retry(decodeURIComponent(reportRetryMatch[1]));
    writeJson(response, 202, { status: "success", data: serializeReport(generation, options.publicBaseUrl) }, options.corsOrigin);
    return true;
  }

  const reportDetailMatch = url.pathname.match(/^\/api\/v1\/admin\/reports\/([^/:]+)$/);
  if (request.method === "GET" && reportDetailMatch) {
    const generation = await reports.get(decodeURIComponent(reportDetailMatch[1]));
    writeJson(response, 200, { status: "success", data: serializeReport(generation, options.publicBaseUrl) }, options.corsOrigin);
    return true;
  }

  return false;
}

function serializeReportDelivery(delivery: { id: string; reportGenerationId: string; channelId: string; channelName?: string; targetId: string; targetName?: string; chatId?: string; status: string; attemptCount: number; messageCount?: number; lastError?: string; createdAt: string; startedAt?: string; sentAt?: string; completedAt?: string }) {
  return { id: delivery.id, report_generation_id: delivery.reportGenerationId, channel_id: delivery.channelId, channel_name: delivery.channelName, target_id: delivery.targetId, target_name: delivery.targetName, chat_id: delivery.chatId, status: delivery.status, attempt_count: delivery.attemptCount, message_count: delivery.messageCount, last_error: delivery.lastError, created_at: delivery.createdAt, started_at: delivery.startedAt, sent_at: delivery.sentAt, completed_at: delivery.completedAt };
}

function serializeReport(report: ReportGeneration, publicBaseUrl?: string) {
  return { id: report.id, definition_id: report.definitionId, source_type: report.sourceType, business_date: report.businessDate, run_id: report.runId, trigger: report.trigger, status: report.status, provider_name: report.providerName, model: report.model, input_item_count: report.inputItemCount, attempt_count: report.attemptCount, content: report.content, insights: report.insights ? serializeReportInsights(report.insights) : undefined, error_code: report.errorCode, error_message: report.errorMessage, parent_generation_id: report.parentGenerationId, public_url: report.status === "completed" && report.shareToken && publicBaseUrl ? `${publicBaseUrl.replace(/\/+$/, "")}/share/reports/${encodeURIComponent(report.shareToken)}` : undefined, created_at: report.createdAt, started_at: report.startedAt, completed_at: report.completedAt };
}

function serializeReportSummary(report: Parameters<typeof serializeReport>[0], publicBaseUrl?: string) {
  const { content: _content, ...summary } = serializeReport(report, publicBaseUrl);
  return summary;
}

function parseReportStatus(value: string): ReportGenerationStatus {
  const values: ReportGenerationStatus[] = ["pending", "running", "completed", "failed"];
  if (!values.includes(value as ReportGenerationStatus)) throw invalidPayload("status is invalid");
  return value as ReportGenerationStatus;
}

function parseReportTrigger(value: string): ReportGenerationTrigger {
  const values: ReportGenerationTrigger[] = ["automatic", "manual", "retry"];
  if (!values.includes(value as ReportGenerationTrigger)) throw invalidPayload("trigger is invalid");
  return value as ReportGenerationTrigger;
}
