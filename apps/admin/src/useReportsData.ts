import { ref } from "vue";
import type { ModelProvider, PageMeta, ReportGeneration, ReportStatus, Run } from "./admin-models";
import { apiFetch, pagePath } from "./useAdminData";

const today = formatLocalDate(new Date());
const reportsDate = ref(today);
const reportsStatus = ref<ReportStatus | "">("");
const reports = ref<ReportGeneration[]>([]);
const reportRuns = ref<Run[]>([]);
const defaultProviderConfigured = ref(false);
const selectedReport = ref<ReportGeneration | null>(null);
const reportLoading = ref(false);
const reportDetailLoading = ref(false);
const reportActionLoading = ref(false);
const reportError = ref("");
const reportPagination = ref<PageMeta>({ total: 0, page: 1, page_size: 20, total_pages: 1 });
let reportRequestSequence = 0;

export function useReportsData() {
  return { reportsDate, reportsStatus, reports, reportRuns, defaultProviderConfigured, selectedReport, reportLoading, reportDetailLoading, reportActionLoading, reportError, reportPagination, refreshReports, selectReport, createReport, retryReport, changeReportPage, formatReportTime, reportStatusLabel };
}

async function refreshReports(options: { background?: boolean } = {}) {
  if (!options.background) reportLoading.value = true;
  reportError.value = "";
  try {
    const query = new URLSearchParams({ date: reportsDate.value, page: String(reportPagination.value.page), page_size: String(reportPagination.value.page_size) });
    if (reportsStatus.value) query.set("status", reportsStatus.value);
    const [response, runsResponse, providersResponse] = await Promise.all([
      apiFetch<ReportGeneration[]>(`/api/v1/admin/reports?${query.toString()}`),
      apiFetch<Run[]>(`/api/v1/admin/runs?date=${encodeURIComponent(reportsDate.value)}&page=1&page_size=100`),
      apiFetch<ModelProvider[]>("/api/v1/admin/model-providers")
    ]);
    reports.value = response.data;
    reportRuns.value = runsResponse.data;
    defaultProviderConfigured.value = providersResponse.data.some((provider) => provider.is_default && provider.status === "active");
    if (response.meta) reportPagination.value = response.meta;
    if (selectedReport.value) {
      const latest = reports.value.find((entry) => entry.id === selectedReport.value?.id);
      if (latest) await selectReport(latest, { background: true });
    }
  } catch (error) {
    reportError.value = error instanceof Error ? error.message : "日报读取失败。";
  } finally {
    if (!options.background) reportLoading.value = false;
  }
}

async function selectReport(report: ReportGeneration, options: { background?: boolean } = {}) {
  const sequence = ++reportRequestSequence;
  selectedReport.value = report;
  if (!options.background) reportDetailLoading.value = true;
  try {
    const response = await apiFetch<ReportGeneration>(`/api/v1/admin/reports/${encodeURIComponent(report.id)}`);
    if (sequence === reportRequestSequence) selectedReport.value = response.data;
  } catch (error) {
    if (sequence === reportRequestSequence) reportError.value = error instanceof Error ? error.message : "日报详情读取失败。";
  } finally {
    if (!options.background && sequence === reportRequestSequence) reportDetailLoading.value = false;
  }
}

async function createReport(runId: string) {
  if (!runId) return;
  reportActionLoading.value = true;
  reportError.value = "";
  try {
    const response = await apiFetch<ReportGeneration>("/api/v1/admin/reports", { method: "POST", body: JSON.stringify({ run_id: runId }) });
    await refreshReports();
    const created = reports.value.find((entry) => entry.id === response.data.id) ?? response.data;
    await selectReport(created);
  } catch (error) {
    reportError.value = error instanceof Error ? error.message : "日报生成任务提交失败。";
  } finally {
    reportActionLoading.value = false;
  }
}

async function retryReport(report: ReportGeneration) {
  reportActionLoading.value = true;
  reportError.value = "";
  try {
    const response = await apiFetch<ReportGeneration>(`/api/v1/admin/reports/${encodeURIComponent(report.id)}:retry`, { method: "POST" });
    await refreshReports();
    await selectReport(reports.value.find((entry) => entry.id === response.data.id) ?? response.data);
  } catch (error) {
    reportError.value = error instanceof Error ? error.message : "日报重试提交失败。";
  } finally {
    reportActionLoading.value = false;
  }
}

async function changeReportPage(page: number) {
  reportPagination.value.page = page;
  await refreshReports();
}

function formatReportTime(value?: string) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "未开始";
}

function reportStatusLabel(status: ReportStatus) {
  return ({ pending: "待生成", running: "生成中", completed: "已完成", failed: "失败" } as Record<ReportStatus, string>)[status];
}

function formatLocalDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
