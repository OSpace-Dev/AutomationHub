<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, watch } from "vue";
import { RouterView, useRoute } from "vue-router";
import AdminSidebar from "./app/AdminSidebar.vue";
import AuthGate from "./app/AuthGate.vue";
import CommandBar from "./app/CommandBar.vue";
import ConnectionSettings from "./app/ConnectionSettings.vue";
import GlobalAlert from "./app/GlobalAlert.vue";
import ReadmePreviewModal from "./app/ReadmePreviewModal.vue";
import { useAdminData } from "./useAdminData";
import type { AdminView } from "./useAdminData";

const route = useRoute();
const data = reactive(useAdminData());
const activeTab = computed<AdminView>(() =>
  ["runs", "devices", "tasks", "monitoring", "reports", "models", "channels"].includes(String(route.name))
    ? (route.name as AdminView)
    : "runs"
);
const pageTitle = computed(
  () =>
    ({
      runs: "每日采集数据",
      devices: "采集设备",
      tasks: "任务中心",
      monitoring: "运行监控",
      reports: "日报中心",
      models: "模型配置",
      channels: "通知渠道"
    })[activeTab.value]
);
let refreshTimer: number | undefined;

function closeReadme() {
  data.selectedItem = null;
}

function refreshCurrentView() {
  return data.refreshView(activeTab.value);
}

watch(
  () => route.name,
  (name) => {
    closeReadme();
    if (name !== "public-report" && data.isAuthenticated) void data.refreshView(activeTab.value);
  }
);

onMounted(async () => {
  await data.initializeAuth();
  if (route.name !== "public-report" && data.isAuthenticated) {
    await refreshCurrentView();
    data.showConnectionSettings = Boolean(data.errorMessage);
  }
  refreshTimer = window.setInterval(() => {
    if (!document.hidden && route.name !== "public-report" && data.isAuthenticated) {
      void data.refreshView(activeTab.value, { background: true });
    }
  }, 30_000);
});

onUnmounted(() => {
  if (refreshTimer) window.clearInterval(refreshTimer);
});
</script>

<template>
  <RouterView v-if="route.name === 'public-report'" />
  <AuthGate
    v-else-if="!data.authReady || !data.isAuthenticated"
    :ready="data.authReady"
    :authenticated="data.isAuthenticated"
    :api-key="data.adminApiKey"
    :error="data.loginError"
    :loading="data.loginLoading"
    @update:api-key="data.adminApiKey = $event"
    @login="data.login(activeTab)"
  />
  <div v-else class="app-shell">
    <AdminSidebar :connection-state="data.connectionState" :connection-label="data.connectionLabel" />
    <main class="main-content">
      <CommandBar
        :title="pageTitle"
        :loading="data.loading"
        :settings-expanded="data.showConnectionSettings"
        @refresh="refreshCurrentView"
        @toggle-settings="data.showConnectionSettings = !data.showConnectionSettings"
      />
      <ConnectionSettings
        v-if="data.showConnectionSettings"
        :api-origin="data.apiOrigin"
        :api-key="data.adminApiKey"
        :error="data.errorMessage || data.loginError"
        :loading="data.loading"
        @update:api-origin="data.apiOrigin = $event"
        @update:api-key="data.adminApiKey = $event"
        @connect="data.connect(activeTab)"
        @close="data.showConnectionSettings = false"
      />
      <GlobalAlert v-if="data.errorMessage" :message="data.errorMessage" @close="data.errorMessage = ''" />
      <div class="view-host"><RouterView /></div>
    </main>
    <ReadmePreviewModal
      v-if="data.selectedItem"
      :item="data.selectedItem"
      :status-label="data.statusLabel"
      :format-time="data.formatTime"
      @close="closeReadme"
    />
  </div>
</template>
