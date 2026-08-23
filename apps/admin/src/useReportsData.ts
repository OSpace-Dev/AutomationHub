import { ref } from "vue";
import type {
  ModelProvider,
  PageMeta,
  ReportDefinition,
  ReportDelivery,
  ReportGeneration,
  ReportStatus,
  Run
} from "./admin-models";
import { apiFetch } from "./composables/apiClient";

const today = formatLocalDate(new Date());
const reportsDate = ref("");
const reportsStatus = ref<ReportStatus | "">("");
const reportsTrigger = ref<ReportGeneration["trigger"] | "">("");
const reportGenerationDate = ref(today);
const reports = ref<ReportGeneration[]>([]);
const reportRuns = ref<Run[]>([]);
const defaultProviderConfigured = ref(false);
const selectedReport = ref<ReportGeneration | null>(null);
const reportLoading = ref(false);
const reportDetailLoading = ref(false);
const reportActionLoading = ref(false);
const reportActionKind = ref<"create" | "regenerate" | "send" | "retry-delivery" | "">("");
const reportError = ref("");
const reportNotice = ref("");
const reportDeliveries = ref<ReportDelivery[]>([]);
const reportDefinition = ref<ReportDefinition | null>(null);
const reportDefinitionLoading = ref(false);
const reportDefinitionSaving = ref(false);
const reportDefinitionError = ref("");
const reportDefinitionNotice = ref("");
const reportPagination = ref<PageMeta>({ total: 0, page: 1, page_size: 20, total_pages: 1 });
let reportRequestSequence = 0;
let reportListRequestSequence = 0;

export function useReportsData() {
  return {
    reportsDate,
    reportsStatus,
    reportsTrigger,
    reportGenerationDate,
    reports,
    reportRuns,
    defaultProviderConfigured,
    selectedReport,
    reportDeliveries,
    reportDefinition,
    reportDefinitionLoading,
    reportDefinitionSaving,
    reportDefinitionError,
    reportDefinitionNotice,
    reportLoading,
    reportDetailLoading,
    reportActionLoading,
    reportActionKind,
    reportError,
    reportNotice,
    reportPagination,
    refreshReports,
    refreshReportRuns,
    refreshReportDefinition,
    updateReportPrompt,
    applyReportFilters,
    resetReportFilters,
    selectReport,
    createReport,
    retryReport,
    sendReport,
    retryDelivery,
    changeReportPage,
    formatReportTime,
    reportStatusLabel,
    deliveryStatusLabel,
    deliveryStatusTone
  };
}

async function refreshReports(options: { background?: boolean } = {}) {
  const sequence = ++reportListRequestSequence;
  if (!options.background) reportLoading.value = true;
  reportError.value = "";
  try {
    const query = new URLSearchParams({
      page: String(reportPagination.value.page),
      page_size: String(reportPagination.value.page_size)
    });
    if (reportsDate.value) query.set("date", reportsDate.value);
    if (reportsStatus.value) query.set("status", reportsStatus.value);
    if (reportsTrigger.value) query.set("trigger", reportsTrigger.value);
    const [response, providersResponse] = await Promise.all([
      apiFetch<ReportGeneration[]>(`/api/v1/admin/reports?${query.toString()}`),
      apiFetch<ModelProvider[]>("/api/v1/admin/model-providers")
    ]);
    if (sequence !== reportListRequestSequence) return;
    reports.value = response.data;
    defaultProviderConfigured.value = providersResponse.data.some(
      (provider) => provider.is_default && provider.status === "active"
    );
    if (response.meta) reportPagination.value = response.meta;
    if (selectedReport.value) {
      const latest = reports.value.find((entry) => entry.id === selectedReport.value?.id);
      if (latest) await selectReport(latest, { background: true });
    }
  } catch (error) {
    if (sequence === reportListRequestSequence)
      reportError.value = error instanceof Error ? error.message : "日报读取失败。";
  } finally {
    if (sequence === reportListRequestSequence) reportLoading.value = false;
  }
}

async function refreshReportRuns() {
  reportError.value = "";
  try {
    const response = await apiFetch<Run[]>(
      `/api/v1/admin/runs?date=${encodeURIComponent(reportGenerationDate.value)}&page=1&page_size=100`
    );
    reportRuns.value = response.data;
  } catch (error) {
    reportRuns.value = [];
    reportError.value = error instanceof Error ? error.message : "采集批次读取失败。";
  }
}

async function refreshReportDefinition() {
  reportDefinitionLoading.value = true;
  reportDefinitionError.value = "";
  try {
    const response = await apiFetch<ReportDefinition>("/api/v1/admin/report-definition");
    reportDefinition.value = response.data;
  } catch (error) {
    reportDefinition.value = null;
    reportDefinitionError.value = error instanceof Error ? error.message : "提示词读取失败。";
  } finally {
    reportDefinitionLoading.value = false;
  }
}

async function updateReportPrompt(promptTemplate: string) {
  reportDefinitionSaving.value = true;
  reportDefinitionError.value = "";
  reportDefinitionNotice.value = "";
  try {
    const response = await apiFetch<ReportDefinition>("/api/v1/admin/report-definition", {
      method: "PUT",
      body: JSON.stringify({ prompt_template: promptTemplate })
    });
    reportDefinition.value = response.data;
    reportDefinitionNotice.value = "日报提示词已保存，后续生成任务将使用新内容。";
    return true;
  } catch (error) {
    reportDefinitionError.value = error instanceof Error ? error.message : "提示词保存失败。";
    return false;
  } finally {
    reportDefinitionSaving.value = false;
  }
}

async function applyReportFilters() {
  reportPagination.value.page = 1;
  clearReportSelection();
  await refreshReports();
}

async function resetReportFilters() {
  reportsDate.value = "";
  reportsStatus.value = "";
  reportsTrigger.value = "";
  await applyReportFilters();
}

async function selectReport(report: ReportGeneration, options: { background?: boolean } = {}) {
  const sequence = ++reportRequestSequence;
  selectedReport.value = report;
  reportDeliveries.value = [];
  if (!options.background) reportDetailLoading.value = true;
  try {
    const response = await apiFetch<ReportGeneration>(`/api/v1/admin/reports/${encodeURIComponent(report.id)}`);
    if (sequence === reportRequestSequence) {
      selectedReport.value = response.data;
      const deliveries = await apiFetch<ReportDelivery[]>(
        `/api/v1/admin/reports/${encodeURIComponent(report.id)}/deliveries`
      );
      if (sequence === reportRequestSequence) reportDeliveries.value = deliveries.data;
    }
  } catch (error) {
    if (sequence === reportRequestSequence)
      reportError.value = error instanceof Error ? error.message : "日报详情读取失败。";
  } finally {
    if (!options.background && sequence === reportRequestSequence) reportDetailLoading.value = false;
  }
}

async function sendReport(report: ReportGeneration) {
  if (report.status !== "completed") return;
  if (
    reportDeliveries.value.length &&
    !window.confirm("确认重新发送这份日报吗？当前启用的 Telegram 目标将再次收到消息。")
  )
    return;
  startReportAction("send");
  try {
    const response = await apiFetch<ReportDelivery[]>(
      `/api/v1/admin/reports/${encodeURIComponent(report.id)}/deliveries`,
      { method: "POST" }
    );
    reportNotice.value = response.data.length
      ? `已提交 ${response.data.length} 个启用目标，发送状态会自动更新。`
      : "没有可用的 Telegram 目标，请先启用 Bot 和会话目标。";
    await selectReport(report);
  } catch (error) {
    reportError.value = error instanceof Error ? error.message : "日报发送任务提交失败。";
  } finally {
    finishReportAction();
  }
}

async function retryDelivery(delivery: ReportDelivery) {
  startReportAction("retry-delivery");
  try {
    await apiFetch<ReportDelivery>(`/api/v1/admin/report-deliveries/${encodeURIComponent(delivery.id)}:retry`, {
      method: "POST"
    });
    reportNotice.value = "失败目标已重新排队。";
    if (selectedReport.value) await selectReport(selectedReport.value);
  } catch (error) {
    reportError.value = error instanceof Error ? error.message : "日报发送重试失败。";
  } finally {
    finishReportAction();
  }
}

async function createReport(runId: string) {
  if (!runId) return false;
  startReportAction("create");
  try {
    const response = await apiFetch<ReportGeneration>("/api/v1/admin/reports", {
      method: "POST",
      body: JSON.stringify({ run_id: runId })
    });
    reportNotice.value = "日报生成任务已创建。";
    await refreshReports();
    const created = reports.value.find((entry) => entry.id === response.data.id) ?? response.data;
    await selectReport(created);
    return true;
  } catch (error) {
    reportError.value = error instanceof Error ? error.message : "日报生成任务提交失败。";
    return false;
  } finally {
    finishReportAction();
  }
}

async function retryReport(report: ReportGeneration) {
  startReportAction("regenerate");
  try {
    const response = await apiFetch<ReportGeneration>(`/api/v1/admin/reports/${encodeURIComponent(report.id)}:retry`, {
      method: "POST"
    });
    reportNotice.value = "已创建新的日报生成记录，原结果仍然保留。";
    await refreshReports();
    await selectReport(reports.value.find((entry) => entry.id === response.data.id) ?? response.data);
    return true;
  } catch (error) {
    reportError.value = error instanceof Error ? error.message : "日报重试提交失败。";
    return false;
  } finally {
    finishReportAction();
  }
}

async function changeReportPage(page: number) {
  reportPagination.value.page = page;
  clearReportSelection();
  await refreshReports();
}

function clearReportSelection() {
  reportRequestSequence += 1;
  selectedReport.value = null;
  reportDeliveries.value = [];
  reportDetailLoading.value = false;
}

function startReportAction(kind: typeof reportActionKind.value) {
  reportActionLoading.value = true;
  reportActionKind.value = kind;
  reportError.value = "";
  reportNotice.value = "";
}

function finishReportAction() {
  reportActionLoading.value = false;
  reportActionKind.value = "";
}

function formatReportTime(value?: string) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "未开始";
}

function reportStatusLabel(status: ReportStatus) {
  return (
    { pending: "待生成", running: "生成中", completed: "已完成", failed: "失败" } as Record<ReportStatus, string>
  )[status];
}

function deliveryStatusLabel(status: ReportDelivery["status"]) {
  return (
    { pending: "待发送", sending: "发送中", sent: "已发送", failed: "发送失败" } as Record<
      ReportDelivery["status"],
      string
    >
  )[status];
}

function deliveryStatusTone(status: ReportDelivery["status"]) {
  return status === "sent"
    ? "success"
    : status === "failed"
      ? "failed"
      : status === "sending" || status === "pending"
        ? "pending"
        : "";
}

function formatLocalDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
