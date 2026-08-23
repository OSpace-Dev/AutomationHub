<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import ReportCreateDrawer from "../domains/reports/ReportCreateDrawer.vue";
import ReportDetailDrawer from "../domains/reports/ReportDetailDrawer.vue";
import ReportPromptDrawer from "../domains/reports/ReportPromptDrawer.vue";
import ReportsList from "../domains/reports/ReportsList.vue";
import { useReportsData } from "../useReportsData";

const { refreshReports, refreshReportRuns } = useReportsData();
const createDrawerOpen = ref(false);
const detailDrawerOpen = ref(false);
const promptDrawerOpen = ref(false);
let timer: number | undefined;

onMounted(() => {
  void Promise.all([refreshReports(), refreshReportRuns()]);
  timer = window.setInterval(() => {
    if (!document.hidden) void refreshReports({ background: true });
  }, 10_000);
});
onUnmounted(() => {
  if (timer) window.clearInterval(timer);
});
</script>

<template>
  <div class="report-page">
    <ReportsList
      @create="createDrawerOpen = true"
      @open-prompt-settings="promptDrawerOpen = true"
      @open-detail="detailDrawerOpen = true"
      @change-page="detailDrawerOpen = false"
    />
    <ReportCreateDrawer v-model="createDrawerOpen" @created="detailDrawerOpen = true" />
    <ReportDetailDrawer v-model="detailDrawerOpen" />
    <ReportPromptDrawer v-model="promptDrawerOpen" />
  </div>
</template>
