<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { Check, Copy, ExternalLink, FileText, Link2, Play, Plus, RefreshCw, RotateCcw, Send, Sparkles } from "lucide-vue-next";
import { RouterLink } from "vue-router";
import PaginationControl from "../components/PaginationControl.vue";
import MarkdownContent from "../components/MarkdownContent.vue";
import ReportInsights from "../components/ReportInsights.vue";
import { useReportsData } from "../useReportsData";

const {
  reportsDate, reportsStatus, reportsTrigger, reportGenerationDate, reports, reportRuns,
  defaultProviderConfigured, selectedReport, reportDeliveries, reportLoading,
  reportDetailLoading, reportActionLoading, reportActionKind, reportError, reportNotice,
  reportPagination, refreshReports, refreshReportRuns, applyReportFilters, resetReportFilters,
  selectReport, createReport, retryReport, sendReport, retryDelivery, changeReportPage,
  formatReportTime, reportStatusLabel, deliveryStatusLabel, deliveryStatusTone
} = useReportsData();
const selectedRunId = ref("");
const copiedReportId = ref("");
const createDrawerOpen = ref(false);
const detailDrawerOpen = ref(false);
const hasReportFilters = computed(() => Boolean(reportsDate.value || reportsStatus.value || reportsTrigger.value));
const sendCommandLabel = computed(() => reportDeliveries.value.length ? "重新发送日报" : "发送日报");
let timer: number | undefined;

async function copyPublicUrl() {
  if (!selectedReport.value?.public_url) return;
  await navigator.clipboard.writeText(selectedReport.value.public_url);
  copiedReportId.value = selectedReport.value.id;
  window.setTimeout(() => {
    if (copiedReportId.value === selectedReport.value?.id) copiedReportId.value = "";
  }, 1800);
}
async function changeGenerationDate() {
  selectedRunId.value = "";
  await refreshReportRuns();
}
async function submitReport() {
  if (await createReport(selectedRunId.value)) {
    createDrawerOpen.value = false;
    detailDrawerOpen.value = true;
  }
}
async function openReport(report: typeof reports.value[number]) {
  detailDrawerOpen.value = true;
  await selectReport(report);
}
async function regenerateReport() {
  if (selectedReport.value && await retryReport(selectedReport.value)) detailDrawerOpen.value = true;
}
async function filterReports() { detailDrawerOpen.value = false; await applyReportFilters(); }
async function clearReportFilters() { detailDrawerOpen.value = false; await resetReportFilters(); }
async function changePage(page: number) { detailDrawerOpen.value = false; await changeReportPage(page); }
onMounted(() => {
  void Promise.all([refreshReports(), refreshReportRuns()]);
  timer = window.setInterval(() => { if (!document.hidden) void refreshReports({ background: true }); }, 10_000);
});
onUnmounted(() => { if (timer) window.clearInterval(timer); });
</script>

<template>
  <div class="report-page">
    <section class="data-section report-list-workspace" aria-label="日报记录">
      <header class="task-center-toolbar report-list-toolbar"><div><span class="eyebrow">DAILY REPORTS</span><h2>日报记录</h2></div><div class="section-actions"><span class="count-label">共 {{ reportPagination.total }} 份</span><el-button type="primary" @click="createDrawerOpen = true"><Plus :size="16" />生成日报</el-button></div></header>
      <section class="compact-filter-bar report-compact-filter" aria-label="日报筛选">
      <div class="filter-fields">
        <label><span>业务日期</span><input v-model="reportsDate" type="date" @change="filterReports" /></label>
        <label><span>状态</span><select v-model="reportsStatus" @change="filterReports"><option value="">全部状态</option><option value="pending">待生成</option><option value="running">生成中</option><option value="completed">已完成</option><option value="failed">失败</option></select></label>
        <label><span>生成方式</span><select v-model="reportsTrigger" @change="filterReports"><option value="">全部方式</option><option value="automatic">自动生成</option><option value="manual">手动生成</option><option value="retry">重新生成</option></select></label>
      </div>
      <button class="text-button filter-reset" type="button" :disabled="!hasReportFilters" @click="clearReportFilters"><RotateCcw :size="13" aria-hidden="true" />重置</button>
      </section>
      <div v-if="reportError" class="inline-error report-page-message" role="alert">{{ reportError }}</div>
      <div v-if="reportNotice" class="inline-success report-page-message" role="status">{{ reportNotice }}</div>
      <div v-if="reportLoading" class="loading-state" aria-live="polite"><RefreshCw :size="20" class="spinning" /><span>正在读取日报</span></div>
      <div v-else-if="!reports.length" class="empty-state"><FileText :size="28" /><strong>没有符合条件的日报</strong><span>调整筛选条件，或生成一份新日报。</span><el-button type="primary" @click="createDrawerOpen = true"><Plus :size="16" />生成日报</el-button></div>
      <div v-else class="report-table-list" role="list" aria-label="日报生成记录">
        <button v-for="report in reports" :key="report.id" type="button" class="report-table-row" :class="{ selected: selectedReport?.id === report.id }" @click="openReport(report)"><span class="report-date-cell"><span class="sr-only">业务日期：</span><FileText :size="17" /><strong>{{ report.business_date }} 日报</strong></span><span><span class="sr-only">生成方式：</span>{{ report.trigger === 'automatic' ? '自动生成' : report.trigger === 'retry' ? '重新生成' : '手动生成' }}</span><span><span class="sr-only">模型：</span>{{ report.provider_name || '等待模型' }} · {{ report.model || '尚未生成' }}</span><span><span class="sr-only">项目数量：</span>{{ report.input_item_count }} 个项目</span><span><span class="sr-only">创建时间：</span>{{ formatReportTime(report.created_at) }}</span><span class="status" :data-status="report.status"><span class="sr-only">状态：</span>{{ reportStatusLabel(report.status) }}</span></button>
      </div>
      <PaginationControl v-if="reports.length" :page="reportPagination.page" :total-pages="reportPagination.total_pages" :total="reportPagination.total" item-label="份日报" @change="changePage" />
    </section>

    <el-drawer v-model="createDrawerOpen" title="生成日报" size="min(560px, 100%)" class="admin-drawer" :close-on-click-modal="!reportActionLoading" :close-on-press-escape="!reportActionLoading">
      <div class="drawer-form"><div class="drawer-intro"><span class="drawer-icon"><Sparkles :size="18" /></span><div><strong>从采集批次生成日报</strong><span>选择业务日期和已完成批次，生成后自动打开详情。</span></div></div><label>业务日期<input v-model="reportGenerationDate" type="date" @change="changeGenerationDate" /></label><label>采集批次<select v-model="selectedRunId"><option value="">选择采集批次</option><option v-for="run in reportRuns" :key="run.id" :value="run.id">{{ formatReportTime(run.createdAt) }} · {{ run.itemCount }} 项目</option></select></label><div v-if="!defaultProviderConfigured" class="inline-error"><span>尚未配置可用的默认模型。</span><RouterLink to="/settings/models">前往模型配置</RouterLink></div></div>
      <template #footer><div class="drawer-footer"><el-button :disabled="reportActionLoading" @click="createDrawerOpen = false">取消</el-button><el-button type="primary" :loading="reportActionKind === 'create'" :disabled="!selectedRunId || reportActionLoading || !defaultProviderConfigured" @click="submitReport"><Play v-if="reportActionKind !== 'create'" :size="15" />生成日报</el-button></div></template>
    </el-drawer>

    <el-drawer v-model="detailDrawerOpen" :title="selectedReport ? selectedReport.business_date + ' 日报' : '日报详情'" size="min(860px, 100%)" class="admin-drawer report-detail-drawer">
      <div v-if="reportDetailLoading" class="loading-state" aria-live="polite"><RefreshCw :size="20" class="spinning" /><span>正在读取日报详情</span></div>
      <div v-else-if="selectedReport" class="report-drawer-content">
        <div class="detail-hero report-detail-hero"><span class="drawer-icon"><FileText :size="18" /></span><div><strong>{{ selectedReport.provider_name || '等待模型' }} · {{ selectedReport.model || '尚未生成' }}</strong><code>{{ selectedReport.input_item_count }} 个项目 · {{ formatReportTime(selectedReport.created_at) }}</code></div><span class="status" :data-status="selectedReport.status">{{ reportStatusLabel(selectedReport.status) }}</span></div>
        <div class="report-command-bar">
          <div v-if="selectedReport.public_url" class="report-public-link"><Link2 :size="16" aria-hidden="true" /><div><strong>公开阅读</strong><span>{{ selectedReport.public_url }}</span></div></div>
          <div v-else class="report-public-link is-unavailable"><Link2 :size="16" aria-hidden="true" /><div><strong>公开链接未配置</strong><span>请检查服务端 PUBLIC_BASE_URL。</span></div></div>
          <div class="report-command-actions">
            <div v-if="selectedReport.public_url" class="report-share-actions" aria-label="公开链接操作">
              <button class="icon-button" type="button" :title="copiedReportId === selectedReport.id ? '已复制公开链接' : '复制公开链接'" :aria-label="copiedReportId === selectedReport.id ? '已复制公开链接' : '复制公开链接'" @click="copyPublicUrl"><Check v-if="copiedReportId === selectedReport.id" :size="16" /><Copy v-else :size="16" /></button>
              <a class="secondary-button" :href="selectedReport.public_url" target="_blank" rel="noopener noreferrer"><ExternalLink :size="15" /><span>打开公开日报</span></a>
            </div>
            <button class="secondary-button report-regenerate-button" type="button" :disabled="reportActionLoading || selectedReport.status === 'pending' || selectedReport.status === 'running'" @click="regenerateReport"><RefreshCw v-if="reportActionKind === 'regenerate'" :size="15" class="spinning" /><RotateCcw v-else :size="15" /><span>{{ reportActionKind === 'regenerate' ? '提交中' : '重新生成' }}</span></button>
          </div>
        </div>
        <div v-if="selectedReport.status === 'failed'" class="report-failure"><strong>生成失败</strong><code>{{ selectedReport.error_code }}</code><p>{{ selectedReport.error_message }}</p><span>确认模型服务状态后，可以重新生成。</span></div>
        <div v-else-if="selectedReport.status !== 'completed'" class="workspace-empty"><RefreshCw :size="30" :class="{ spinning: selectedReport.status === 'running' }" /><strong>{{ reportStatusLabel(selectedReport.status) }}</strong><span>页面会自动更新当前日报状态，并保留列表条件。</span></div>
        <div v-else class="report-drawer-scroll">
          <section class="delivery-panel" aria-live="polite">
            <div class="delivery-panel-header">
              <div><span class="eyebrow">TELEGRAM DELIVERY</span><h3>推送状态</h3><p>重新发送会把当前启用目标再次排队；失败目标也可以单独重试。</p></div>
              <button class="secondary-button" type="button" :disabled="reportActionLoading" @click="sendReport(selectedReport)"><RefreshCw v-if="reportActionKind === 'send'" :size="15" class="spinning" /><Send v-else :size="15" /><span>{{ reportActionKind === 'send' ? '提交中' : sendCommandLabel }}</span></button>
            </div>
            <div v-if="!reportDeliveries.length" class="delivery-empty"><Send :size="17" /><span>尚未创建发送任务。请先在“通知渠道”中启用 Bot 和 chat 目标。</span></div>
            <div v-else class="delivery-list">
              <div v-for="delivery in reportDeliveries" :key="delivery.id" class="delivery-row">
                <div class="delivery-row-main"><strong>{{ delivery.target_name || delivery.chat_id || 'Telegram 目标' }}</strong><small>{{ delivery.channel_name || 'Telegram Bot' }}<span v-if="delivery.chat_id"> · {{ delivery.chat_id }}</span></small></div>
                <span class="status" :data-status="deliveryStatusTone(delivery.status)">{{ deliveryStatusLabel(delivery.status) }}</span>
                <small class="delivery-attempt">第 {{ delivery.attempt_count }} 次尝试<span v-if="delivery.message_count"> · {{ delivery.message_count }} 条消息</span></small>
                <button v-if="delivery.status === 'failed'" class="text-button danger-text" type="button" :disabled="reportActionLoading" @click="retryDelivery(delivery)"><RefreshCw v-if="reportActionKind === 'retry-delivery'" :size="13" class="spinning" /><RotateCcw v-else :size="13" />重试</button>
                <span v-if="delivery.last_error" class="delivery-error">{{ delivery.last_error }}</span>
              </div>
            </div>
          </section>
          <div class="report-content"><ReportInsights v-if="selectedReport.insights" :insights="selectedReport.insights" /><MarkdownContent v-else :content="selectedReport.content" /></div>
        </div>
      </div>
      <template #footer><div class="drawer-footer"><el-button @click="detailDrawerOpen = false">关闭</el-button></div></template>
    </el-drawer>
  </div>
</template>
