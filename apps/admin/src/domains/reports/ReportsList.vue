<script setup lang="ts">
import { computed } from "vue";
import { FileText, Plus, RefreshCw, RotateCcw } from "lucide-vue-next";
import PaginationControl from "../../components/PaginationControl.vue";
import { useReportsData } from "../../useReportsData";

const emit = defineEmits<{ create: []; openDetail: []; changePage: [] }>();
const {
  reportsDate,
  reportsStatus,
  reportsTrigger,
  reports,
  selectedReport,
  reportLoading,
  reportError,
  reportNotice,
  reportPagination,
  applyReportFilters,
  resetReportFilters,
  selectReport,
  changeReportPage,
  formatReportTime,
  reportStatusLabel
} = useReportsData();
const hasReportFilters = computed(() => Boolean(reportsDate.value || reportsStatus.value || reportsTrigger.value));

async function filterReports() {
  emit("changePage");
  await applyReportFilters();
}
async function clearReportFilters() {
  emit("changePage");
  await resetReportFilters();
}
async function openReport(report: (typeof reports.value)[number]) {
  emit("openDetail");
  await selectReport(report);
}
async function changePage(page: number) {
  emit("changePage");
  await changeReportPage(page);
}
</script>

<template>
  <section class="data-section report-list-workspace" aria-label="日报记录">
    <header class="task-center-toolbar report-list-toolbar">
      <div>
        <span class="eyebrow">DAILY REPORTS</span>
        <h2>日报记录</h2>
      </div>
      <div class="section-actions">
        <span class="count-label">共 {{ reportPagination.total }} 份</span
        ><el-button type="primary" @click="emit('create')"><Plus :size="16" />生成日报</el-button>
      </div>
    </header>
    <section class="compact-filter-bar report-compact-filter" aria-label="日报筛选">
      <div class="filter-fields">
        <label><span>业务日期</span><input v-model="reportsDate" type="date" @change="filterReports" /></label>
        <label
          ><span>状态</span
          ><select v-model="reportsStatus" @change="filterReports">
            <option value="">全部状态</option>
            <option value="pending">待生成</option>
            <option value="running">生成中</option>
            <option value="completed">已完成</option>
            <option value="failed">失败</option>
          </select></label
        >
        <label
          ><span>生成方式</span
          ><select v-model="reportsTrigger" @change="filterReports">
            <option value="">全部方式</option>
            <option value="automatic">自动生成</option>
            <option value="manual">手动生成</option>
            <option value="retry">重新生成</option>
          </select></label
        >
      </div>
      <button class="text-button filter-reset" type="button" :disabled="!hasReportFilters" @click="clearReportFilters">
        <RotateCcw :size="13" aria-hidden="true" />重置
      </button>
    </section>
    <div v-if="reportError" class="inline-error report-page-message" role="alert">{{ reportError }}</div>
    <div v-if="reportNotice" class="inline-success report-page-message" role="status">{{ reportNotice }}</div>
    <div v-if="reportLoading" class="loading-state" aria-live="polite">
      <RefreshCw :size="20" class="spinning" /><span>正在读取日报</span>
    </div>
    <div v-else-if="!reports.length" class="empty-state">
      <FileText :size="28" /><strong>没有符合条件的日报</strong><span>调整筛选条件，或生成一份新日报。</span
      ><el-button type="primary" @click="emit('create')"><Plus :size="16" />生成日报</el-button>
    </div>
    <div v-else class="report-table-list" role="list" aria-label="日报生成记录">
      <button
        v-for="report in reports"
        :key="report.id"
        type="button"
        class="report-table-row"
        :class="{ selected: selectedReport?.id === report.id }"
        @click="openReport(report)"
      >
        <span class="report-date-cell"
          ><span class="sr-only">业务日期：</span><FileText :size="17" /><strong
            >{{ report.business_date }} 日报</strong
          ></span
        ><span
          ><span class="sr-only">生成方式：</span
          >{{
            report.trigger === "automatic" ? "自动生成" : report.trigger === "retry" ? "重新生成" : "手动生成"
          }}</span
        ><span
          ><span class="sr-only">模型：</span>{{ report.provider_name || "等待模型" }} ·
          {{ report.model || "尚未生成" }}</span
        ><span><span class="sr-only">项目数量：</span>{{ report.input_item_count }} 个项目</span
        ><span><span class="sr-only">创建时间：</span>{{ formatReportTime(report.created_at) }}</span
        ><span class="status" :data-status="report.status"
          ><span class="sr-only">状态：</span>{{ reportStatusLabel(report.status) }}</span
        >
      </button>
    </div>
    <PaginationControl
      v-if="reports.length"
      :page="reportPagination.page"
      :total-pages="reportPagination.total_pages"
      :total="reportPagination.total"
      item-label="份日报"
      @change="changePage"
    />
  </section>
</template>
