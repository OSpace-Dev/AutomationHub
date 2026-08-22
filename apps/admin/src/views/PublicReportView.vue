<script setup lang="ts">
import { AlertCircle, CalendarDays, FileText, RefreshCw } from "lucide-vue-next";
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import MarkdownContent from "../components/MarkdownContent.vue";
import ReportInsights from "../components/ReportInsights.vue";
import type { ApiResponse, PublicReport } from "../admin-models";
import { apiOrigin } from "../composables/apiClient";

const route = useRoute();
const report = ref<PublicReport | null>(null);
const loading = ref(true);
const error = ref("");

onMounted(loadReport);

async function loadReport() {
  loading.value = true;
  error.value = "";
  try {
    const token = String(route.params.token ?? "");
    const response = await fetch(
      `${apiOrigin.value.replace(/\/$/, "")}/api/v1/public/reports/${encodeURIComponent(token)}`
    );
    const body = (await response.json()) as ApiResponse<PublicReport>;
    if (!response.ok) throw new Error(body.message || "这份日报不存在或尚未完成。");
    report.value = body.data;
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "日报读取失败。";
  } finally {
    loading.value = false;
  }
}

function formatTime(value?: string) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "";
}
</script>

<template>
  <main class="public-report-page">
    <header class="public-report-brand">
      <span class="brand-mark">AH</span>
      <div><strong>AutomationHub</strong><span>趋势日报</span></div>
    </header>
    <section class="public-report-card">
      <div v-if="loading" class="public-report-state">
        <RefreshCw :size="28" class="spinning" /><strong>正在读取日报</strong>
      </div>
      <div v-else-if="error" class="public-report-state error" role="alert">
        <AlertCircle :size="30" /><strong>无法打开这份日报</strong><span>{{ error }}</span>
      </div>
      <template v-else-if="report">
        <header class="public-report-header">
          <div>
            <span class="eyebrow">DAILY REPORT</span>
            <h1>{{ report.business_date }} GitHub Trending 日报</h1>
          </div>
          <div class="public-report-meta">
            <span><CalendarDays :size="15" />{{ report.business_date }}</span
            ><span v-if="report.completed_at"><FileText :size="15" />生成于 {{ formatTime(report.completed_at) }}</span>
          </div>
        </header>
        <ReportInsights v-if="report.insights" :insights="report.insights" />
        <MarkdownContent v-else :content="report.content" />
      </template>
    </section>
    <footer class="public-report-footer">由 AutomationHub 自动生成</footer>
  </main>
</template>
