<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { Check, Copy, ExternalLink, FileText, Link2, Play, RefreshCw, RotateCcw, Send, SlidersHorizontal, Sparkles } from "lucide-vue-next";
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
onMounted(() => {
  void Promise.all([refreshReports(), refreshReportRuns()]);
  timer = window.setInterval(() => { if (!document.hidden) void refreshReports({ background: true }); }, 10_000);
});
onUnmounted(() => { if (timer) window.clearInterval(timer); });
</script>

<template>
  <div class="report-page">
    <section class="report-create-bar" aria-labelledby="report-create-title">
      <div class="report-create-copy"><span class="report-create-icon"><Sparkles :size="17" aria-hidden="true" /></span><div><h2 id="report-create-title">生成日报</h2><p>从指定日期的采集批次创建一份新日报。</p></div></div>
      <div class="report-create-fields">
        <label><span>业务日期</span><input v-model="reportGenerationDate" type="date" @change="changeGenerationDate" /></label>
        <label class="report-run-field"><span>采集批次</span><select v-model="selectedRunId"><option value="">选择采集批次</option><option v-for="run in reportRuns" :key="run.id" :value="run.id">{{ formatReportTime(run.createdAt) }} · {{ run.itemCount }} 项目</option></select></label>
      </div>
      <div class="report-create-action">
        <button class="primary-button" type="button" :disabled="!selectedRunId || reportActionLoading || !defaultProviderConfigured" @click="createReport(selectedRunId)"><RefreshCw v-if="reportActionKind === 'create'" :size="15" class="spinning" /><Play v-else :size="15" /><span>{{ reportActionKind === 'create' ? '提交中' : '生成日报' }}</span></button>
        <RouterLink v-if="!defaultProviderConfigured" to="/settings/models">配置默认模型</RouterLink>
      </div>
    </section>

    <section class="filter-panel report-filter-panel" aria-labelledby="report-filter-title">
      <div class="filter-panel-heading"><SlidersHorizontal :size="16" aria-hidden="true" /><div><h2 id="report-filter-title">筛选日报</h2><p>默认展示全部历史记录，按需缩小范围。</p></div></div>
      <div class="filter-fields">
        <label><span>业务日期</span><input v-model="reportsDate" type="date" @change="applyReportFilters" /></label>
        <label><span>状态</span><select v-model="reportsStatus" @change="applyReportFilters"><option value="">全部状态</option><option value="pending">待生成</option><option value="running">生成中</option><option value="completed">已完成</option><option value="failed">失败</option></select></label>
        <label><span>生成方式</span><select v-model="reportsTrigger" @change="applyReportFilters"><option value="">全部方式</option><option value="automatic">自动生成</option><option value="manual">手动生成</option><option value="retry">重新生成</option></select></label>
      </div>
      <div class="filter-panel-summary"><span>共 {{ reportPagination.total }} 份日报</span><button class="text-button" type="button" :disabled="!hasReportFilters" @click="resetReportFilters"><RotateCcw :size="13" aria-hidden="true" />清除筛选</button></div>
    </section>

    <div v-if="reportError" class="inline-error" role="alert">{{ reportError }}</div>
    <div v-if="reportNotice" class="inline-success" role="status">{{ reportNotice }}</div>

    <section class="reports-workspace">
      <aside class="report-list-panel">
        <div class="workspace-panel-header"><div><span class="eyebrow">DAILY REPORTS</span><h2>日报记录</h2></div><span class="count-label">{{ reportPagination.total }}</span></div>
        <div v-if="reportLoading" class="loading-state compact"><RefreshCw :size="18" class="spinning" /><span>正在读取日报</span></div>
        <div v-else-if="!reports.length" class="empty-state compact"><FileText :size="27" /><strong>没有符合条件的日报</strong><span>调整筛选条件，或从上方选择批次生成。</span></div>
        <div v-else class="report-list" role="listbox" aria-label="日报生成记录">
          <button v-for="report in reports" :key="report.id" type="button" class="report-list-item" :class="{ selected: selectedReport?.id === report.id }" :aria-selected="selectedReport?.id === report.id" @click="selectReport(report)">
            <span class="report-list-top"><strong>{{ report.business_date }}</strong><span class="status" :data-status="report.status">{{ reportStatusLabel(report.status) }}</span></span>
            <span>{{ report.trigger === 'automatic' ? '自动生成' : report.trigger === 'retry' ? '重新生成' : '手动生成' }} · {{ report.model || '等待分配模型' }}</span>
            <small>{{ formatReportTime(report.created_at) }}</small>
          </button>
        </div>
        <PaginationControl v-if="reports.length" :page="reportPagination.page" :total-pages="reportPagination.total_pages" :total="reportPagination.total" item-label="份日报" @change="changeReportPage" />
      </aside>

      <section class="report-detail-panel">
        <div class="workspace-panel-header report-detail-header">
          <div><span class="eyebrow">REPORT CONTENT</span><h2>{{ selectedReport ? selectedReport.business_date + ' 日报' : '选择一份日报' }}</h2><p v-if="selectedReport">{{ selectedReport.provider_name || '等待模型' }} · {{ selectedReport.model || '尚未生成' }} · {{ selectedReport.input_item_count }} 个项目</p></div>
          <span v-if="selectedReport" class="status" :data-status="selectedReport.status">{{ reportStatusLabel(selectedReport.status) }}</span>
        </div>
        <div v-if="selectedReport" class="report-command-bar">
          <div v-if="selectedReport.public_url" class="report-public-link"><Link2 :size="16" aria-hidden="true" /><div><strong>公开阅读</strong><span>{{ selectedReport.public_url }}</span></div></div>
          <div v-else class="report-public-link is-unavailable"><Link2 :size="16" aria-hidden="true" /><div><strong>公开链接未配置</strong><span>请检查服务端 PUBLIC_BASE_URL。</span></div></div>
          <div class="report-command-actions">
            <div v-if="selectedReport.public_url" class="report-share-actions" aria-label="公开链接操作">
              <button class="icon-button" type="button" :title="copiedReportId === selectedReport.id ? '已复制公开链接' : '复制公开链接'" :aria-label="copiedReportId === selectedReport.id ? '已复制公开链接' : '复制公开链接'" @click="copyPublicUrl"><Check v-if="copiedReportId === selectedReport.id" :size="16" /><Copy v-else :size="16" /></button>
              <a class="secondary-button" :href="selectedReport.public_url" target="_blank" rel="noopener noreferrer"><ExternalLink :size="15" /><span>打开公开日报</span></a>
            </div>
            <button class="secondary-button report-regenerate-button" type="button" :disabled="reportActionLoading || selectedReport.status === 'pending' || selectedReport.status === 'running'" @click="retryReport(selectedReport)"><RefreshCw v-if="reportActionKind === 'regenerate'" :size="15" class="spinning" /><RotateCcw v-else :size="15" /><span>{{ reportActionKind === 'regenerate' ? '提交中' : '重新生成' }}</span></button>
          </div>
        </div>
        <div v-if="reportDetailLoading" class="loading-state"><RefreshCw :size="20" class="spinning" /><span>正在读取日报详情</span></div>
        <div v-else-if="!selectedReport" class="workspace-empty"><FileText :size="35" /><strong>日报正文会显示在这里</strong><span>左侧默认保留全部历史记录，筛选不会修改日报内容。</span></div>
        <div v-else-if="selectedReport.status === 'failed'" class="report-failure"><strong>生成失败</strong><code>{{ selectedReport.error_code }}</code><p>{{ selectedReport.error_message }}</p><span>确认模型服务状态后，可以从上方命令条重新生成。</span></div>
        <div v-else-if="selectedReport.status !== 'completed'" class="workspace-empty"><RefreshCw :size="30" :class="{ spinning: selectedReport.status === 'running' }" /><strong>{{ reportStatusLabel(selectedReport.status) }}</strong><span>页面会自动更新当前日报状态，并保留筛选条件。</span></div>
        <div v-else class="report-detail-scroll">
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
      </section>
    </section>
  </div>
</template>
