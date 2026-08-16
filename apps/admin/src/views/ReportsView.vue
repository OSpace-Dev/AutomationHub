<script setup lang="ts">
import { CalendarDays, Check, Copy, ExternalLink, FileText, Play, RefreshCw, RotateCcw, Sparkles } from "lucide-vue-next";
import { onMounted, onUnmounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import PaginationControl from "../components/PaginationControl.vue";
import MarkdownContent from "../components/MarkdownContent.vue";
import ReportInsights from "../components/ReportInsights.vue";
import { useReportsData } from "../useReportsData";

const { reportsDate, reportsStatus, reports, reportRuns, defaultProviderConfigured, selectedReport, reportLoading, reportDetailLoading, reportActionLoading, reportError, reportPagination, refreshReports, selectReport, createReport, retryReport, changeReportPage, formatReportTime, reportStatusLabel } = useReportsData();
const selectedRunId = ref("");
const copiedReportId = ref("");
let timer: number | undefined;

async function copyPublicUrl() {
  if (!selectedReport.value?.public_url) return;
  await navigator.clipboard.writeText(selectedReport.value.public_url);
  copiedReportId.value = selectedReport.value.id;
  window.setTimeout(() => {
    if (copiedReportId.value === selectedReport.value?.id) copiedReportId.value = "";
  }, 1800);
}

watch(reportsDate, () => {
  reportPagination.value.page = 1;
  selectedRunId.value = "";
  void refreshReports();
});
watch(reportsStatus, () => {
  reportPagination.value.page = 1;
  void refreshReports();
});
onMounted(() => {
  void refreshReports();
  timer = window.setInterval(() => { if (!document.hidden) void refreshReports({ background: true }); }, 10_000);
});
onUnmounted(() => { if (timer) window.clearInterval(timer); });
</script>

<template>
  <div class="report-page">
    <section class="report-create-card">
      <div class="report-create-copy"><Sparkles :size="19" aria-hidden="true" /><div><strong>生成日报</strong><span>自动任务会在采集完成后生成；这里也可以按批次手动生成。</span></div></div>
      <label><span><CalendarDays :size="14" aria-hidden="true" />业务日期</span><input v-model="reportsDate" type="date" /></label>
      <label>采集批次<select v-model="selectedRunId"><option value="">选择当天批次</option><option v-for="run in reportRuns" :key="run.id" :value="run.id">{{ formatReportTime(run.createdAt) }} · {{ run.itemCount }} 项目</option></select></label>
      <div class="report-create-action">
        <button class="primary-button" type="button" :disabled="!selectedRunId || reportActionLoading || !defaultProviderConfigured" @click="createReport(selectedRunId)"><RefreshCw v-if="reportActionLoading" :size="15" class="spinning" /><Play v-else :size="15" /><span>{{ reportActionLoading ? '提交中' : '生成日报' }}</span></button>
        <RouterLink v-if="!defaultProviderConfigured" to="/settings/models">先配置默认模型</RouterLink>
      </div>
    </section>

    <div v-if="reportError" class="inline-error" role="alert">{{ reportError }}</div>

    <section class="reports-workspace">
      <aside class="report-list-panel">
        <div class="workspace-panel-header"><div><span class="eyebrow">DAILY REPORTS</span><h2>生成记录</h2></div><span class="count-label">{{ reportPagination.total }}</span></div>
        <div class="module-filter-row"><label class="compact-select">状态<select v-model="reportsStatus"><option value="">全部状态</option><option value="pending">待生成</option><option value="running">生成中</option><option value="completed">已完成</option><option value="failed">失败</option></select></label></div>
        <div v-if="reportLoading" class="loading-state compact"><RefreshCw :size="18" class="spinning" /><span>正在读取日报</span></div>
        <div v-else-if="!reports.length" class="empty-state compact"><FileText :size="27" /><strong>当天暂无日报</strong><span>完成采集或从上方选择批次生成。</span></div>
        <div v-else class="report-list" role="listbox" aria-label="日报生成记录">
          <button v-for="report in reports" :key="report.id" type="button" class="report-list-item" :class="{ selected: selectedReport?.id === report.id }" :aria-selected="selectedReport?.id === report.id" @click="selectReport(report)">
            <span class="report-list-top"><strong>{{ formatReportTime(report.created_at) }}</strong><span class="status" :data-status="report.status">{{ reportStatusLabel(report.status) }}</span></span>
            <span>{{ report.trigger === 'automatic' ? '自动生成' : report.trigger === 'retry' ? '重新生成' : '手动生成' }} · {{ report.model || '等待分配模型' }}</span>
            <small>{{ report.run_id }}</small>
          </button>
        </div>
        <PaginationControl v-if="reports.length" :page="reportPagination.page" :total-pages="reportPagination.total_pages" :total="reportPagination.total" item-label="份日报" @change="changeReportPage" />
      </aside>

      <section class="report-detail-panel">
        <div class="workspace-panel-header report-detail-header">
          <div><span class="eyebrow">REPORT CONTENT</span><h2>{{ selectedReport ? `${selectedReport.business_date} 日报` : '选择一份日报' }}</h2><p v-if="selectedReport">{{ selectedReport.provider_name || '等待模型' }} · {{ selectedReport.model || '尚未生成' }} · {{ selectedReport.input_item_count }} 个项目</p></div>
          <div v-if="selectedReport" class="report-detail-actions">
            <button v-if="selectedReport.public_url" class="secondary-button" type="button" @click="copyPublicUrl"><Check v-if="copiedReportId === selectedReport.id" :size="15" /><Copy v-else :size="15" /><span>{{ copiedReportId === selectedReport.id ? '已复制' : '复制公开链接' }}</span></button>
            <a v-if="selectedReport.public_url" class="icon-button" :href="selectedReport.public_url" target="_blank" rel="noopener noreferrer" title="打开公开阅读页" aria-label="打开公开阅读页"><ExternalLink :size="16" /></a>
            <button class="secondary-button" type="button" :disabled="reportActionLoading || selectedReport.status === 'pending' || selectedReport.status === 'running'" @click="retryReport(selectedReport)"><RotateCcw :size="15" /><span>重新生成</span></button>
          </div>
        </div>
        <div v-if="reportDetailLoading" class="loading-state"><RefreshCw :size="20" class="spinning" /><span>正在读取日报详情</span></div>
        <div v-else-if="!selectedReport" class="workspace-empty"><FileText :size="35" /><strong>日报正文会显示在这里</strong><span>左侧保留所有历史生成记录，重新生成不会覆盖已有成功结果。</span></div>
        <div v-else-if="selectedReport.status === 'failed'" class="report-failure"><strong>生成失败</strong><code>{{ selectedReport.error_code }}</code><p>{{ selectedReport.error_message }}</p><span>网关超时会自动重试当前项目批次；如果仍然失败，请确认模型服务状态后重新生成。</span></div>
        <div v-else-if="selectedReport.status !== 'completed'" class="workspace-empty"><RefreshCw :size="30" :class="{ spinning: selectedReport.status === 'running' }" /><strong>{{ reportStatusLabel(selectedReport.status) }}</strong><span>页面只刷新当前日报模块，并保留选中项和阅读位置。</span></div>
        <div v-else class="report-content">
          <div v-if="!selectedReport.public_url" class="report-share-hint">配置服务端 <code>PUBLIC_BASE_URL</code> 后，这份日报会获得可对外访问的阅读地址。</div>
          <ReportInsights v-if="selectedReport.insights" :insights="selectedReport.insights" />
          <MarkdownContent v-else :content="selectedReport.content" />
        </div>
      </section>
    </section>
  </div>
</template>
