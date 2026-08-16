<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { RouterLink, RouterView, useRoute } from "vue-router";
import { Activity, AlertCircle, Bot, Database, ExternalLink, FileText, Layers3, Maximize2, Minimize2, Monitor, RefreshCw, Server, Settings, Wifi, X } from "lucide-vue-next";
import { useAdminData } from "./useAdminData";
import type { AdminView } from "./useAdminData";

const route = useRoute();
const data = reactive(useAdminData());
const readmeFullscreen = ref(false);
const activeTab = computed<AdminView>(() => (["runs", "devices", "tasks", "monitoring", "reports", "models"].includes(String(route.name)) ? route.name as AdminView : "runs"));
const pageTitle = computed(() => ({ runs: "每日采集数据", devices: "采集设备", tasks: "任务中心", monitoring: "运行监控", reports: "日报中心", models: "模型配置" }[activeTab.value]));
const pageSubtitle = computed(() => ({ runs: "浏览每日批次并核对项目 README 结果", devices: "掌握采集节点的连接与队列状态", tasks: "下发、跟踪和取消采集任务", monitoring: "查看心跳与插件运行事件", reports: "阅读、手动生成和追踪每日业务总结", models: "管理 OpenAI 兼容服务和自动日报默认模型" }[activeTab.value]));
const previewSrcdoc = computed(() => {
  const html = data.selectedItem?.readmeHtml;
  if (!html) return "";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline';"><style>body{font:14px/1.65 system-ui,sans-serif;color:#25282b;padding:24px;max-width:920px;margin:auto}img{max-width:100%;height:auto}a{color:#1668c7}pre{overflow:auto;padding:12px;background:#f5f6f6}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}table{display:block;overflow:auto;border-collapse:collapse}td,th{padding:6px;border:1px solid #ddd}</style></head><body>${html}</body></html>`;
});
let refreshTimer: number | undefined;
function closeReadme() { data.selectedItem = null; readmeFullscreen.value = false; }
function handleKeydown(event: KeyboardEvent) { if (event.key === "Escape" && data.selectedItem) closeReadme(); }
function refreshCurrentView() { return data.refreshView(activeTab.value); }
function connectCurrentView() { return data.connect(activeTab.value); }
watch(activeTab, (view) => { closeReadme(); void data.refreshView(view); });
onMounted(async () => { document.addEventListener("keydown", handleKeydown); await refreshCurrentView(); data.showConnectionSettings = Boolean(data.errorMessage); refreshTimer = window.setInterval(() => { if (!document.hidden) void data.refreshView(activeTab.value, { background: true }); }, 30_000); });
onUnmounted(() => { document.removeEventListener("keydown", handleKeydown); if (refreshTimer) window.clearInterval(refreshTimer); });
</script>

<template>
  <RouterView v-if="route.name === 'public-report'" />
  <div v-else class="app-shell">
    <aside class="sidebar"><div class="brand"><span class="brand-mark">AH</span><div><strong>AutomationHub</strong><span>采集管理</span></div></div>
      <span class="nav-label">工作台</span>
      <nav class="primary-nav" aria-label="主导航">
        <RouterLink to="/runs" custom v-slot="{ navigate, isActive }"><button type="button" :class="{ active: isActive }" @click="navigate"><Database :size="18" aria-hidden="true" /><span>采集数据</span></button></RouterLink>
        <RouterLink to="/devices" custom v-slot="{ navigate, isActive }"><button type="button" :class="{ active: isActive }" @click="navigate"><Monitor :size="18" aria-hidden="true" /><span>设备管理</span></button></RouterLink>
        <RouterLink to="/tasks" custom v-slot="{ navigate, isActive }"><button type="button" :class="{ active: isActive }" @click="navigate"><Activity :size="18" aria-hidden="true" /><span>任务中心</span></button></RouterLink>
        <RouterLink to="/monitoring" custom v-slot="{ navigate, isActive }"><button type="button" :class="{ active: isActive }" @click="navigate"><Wifi :size="18" aria-hidden="true" /><span>运行监控</span></button></RouterLink>
        <RouterLink to="/reports" custom v-slot="{ navigate, isActive }"><button type="button" :class="{ active: isActive }" @click="navigate"><FileText :size="18" aria-hidden="true" /><span>日报中心</span></button></RouterLink>
      </nav>
      <span class="nav-label">系统设置</span>
      <nav class="primary-nav" aria-label="系统设置">
        <RouterLink to="/settings/models" custom v-slot="{ navigate, isActive }"><button type="button" :class="{ active: isActive }" @click="navigate"><Bot :size="18" aria-hidden="true" /><span>模型配置</span></button></RouterLink>
      </nav>
      <div class="sidebar-status" :data-state="data.connectionState"><Wifi :size="16" aria-hidden="true" /><div><span>API 状态</span><strong>{{ data.connectionLabel }}</strong></div></div>
    </aside>

    <main class="main-content"><header class="command-bar"><div><p class="page-kicker">TRENDING README</p><h1>{{ pageTitle }}</h1><p class="page-subtitle">{{ pageSubtitle }}</p></div><div class="command-actions">
      <button class="icon-button" type="button" :disabled="data.loading" title="刷新当前页面" aria-label="刷新当前页面" @click="refreshCurrentView"><RefreshCw :size="18" :class="{ spinning: data.loading }" aria-hidden="true" /></button>
      <button class="icon-button" type="button" title="连接设置" aria-label="连接设置" :aria-expanded="data.showConnectionSettings" @click="data.showConnectionSettings = !data.showConnectionSettings"><Settings :size="18" aria-hidden="true" /></button>
    </div></header>
      <section v-if="data.showConnectionSettings" class="connection-band" aria-label="管理 API 连接设置"><div class="connection-heading"><Server :size="19" aria-hidden="true" /><div><strong>管理 API</strong><span>本地联调可留空管理密钥</span></div></div><label>API 地址<input v-model="data.apiOrigin" type="url" placeholder="http://localhost:3000" /></label><label>管理密钥<input v-model="data.adminApiKey" type="password" autocomplete="off" placeholder="受保护部署时填写" /></label><button class="primary-button" type="button" :disabled="data.loading" @click="connectCurrentView"><RefreshCw v-if="data.loading" :size="16" class="spinning" aria-hidden="true" /><span>{{ data.loading ? '连接中' : '连接并读取' }}</span></button></section>
      <div v-if="data.errorMessage" class="alert" role="alert"><AlertCircle :size="18" aria-hidden="true" /><span>{{ data.errorMessage }}</span><button type="button" title="关闭错误提示" aria-label="关闭错误提示" @click="data.errorMessage = ''"><X :size="17" aria-hidden="true" /></button></div>
      <section v-if="activeTab === 'runs'" class="metrics-grid" aria-label="采集数据概览"><div class="metric-card"><span>当日批次</span><strong>{{ data.metrics.runs }}</strong><Activity :size="19" aria-hidden="true" /></div><div class="metric-card"><span>本页项目</span><strong>{{ data.metrics.projects }}</strong><Layers3 :size="19" aria-hidden="true" /></div><div class="metric-card" data-tone="success"><span>本页成功</span><strong>{{ data.metrics.success }}</strong><Database :size="19" aria-hidden="true" /></div><div class="metric-card" data-tone="danger"><span>本页失败</span><strong>{{ data.metrics.failed }}</strong><AlertCircle :size="19" aria-hidden="true" /></div></section>
      <section v-else-if="activeTab === 'devices'" class="metrics-grid compact-grid" aria-label="设备概览"><div class="metric-card"><span>设备总数</span><strong>{{ data.pagination.devices.total }}</strong><Monitor :size="19" aria-hidden="true" /></div><div class="metric-card" data-tone="success"><span>本页在线</span><strong>{{ data.metrics.onlineDevices }}</strong><Wifi :size="19" aria-hidden="true" /></div></section>
      <section v-else-if="activeTab === 'tasks'" class="metrics-grid compact-grid" aria-label="任务概览"><div class="metric-card"><span>任务总数</span><strong>{{ data.pagination.tasks.total }}</strong><Activity :size="19" aria-hidden="true" /></div><div class="metric-card"><span>本页进行中</span><strong>{{ data.metrics.pendingTasks }}</strong><RefreshCw :size="19" aria-hidden="true" /></div></section>
      <section v-else-if="activeTab === 'monitoring'" class="metrics-grid compact-grid" aria-label="日志概览"><div class="metric-card"><span>日志总数</span><strong>{{ data.pagination.logs.total }}</strong><Activity :size="19" aria-hidden="true" /></div><div class="metric-card" data-tone="success"><span>在线设备</span><strong>{{ data.metrics.monitoringOnlineDevices }}</strong><Wifi :size="19" aria-hidden="true" /></div></section>
      <div class="view-host"><RouterView /></div>
    </main>

    <Teleport to="body"><div v-if="data.selectedItem" class="modal-backdrop" @click.self="closeReadme"><section class="readme-modal" :class="{ fullscreen: readmeFullscreen }" role="dialog" aria-modal="true" aria-labelledby="readme-title"><header><div><span>README 详情</span><h2 id="readme-title">{{ data.selectedItem.name }}</h2></div><div class="modal-actions"><a class="icon-button" :href="data.selectedItem.projectUrl" target="_blank" rel="noreferrer" title="在 GitHub 打开" aria-label="在 GitHub 打开"><ExternalLink :size="18" aria-hidden="true" /></a><button class="icon-button" type="button" :title="readmeFullscreen ? '退出全屏' : '全屏查看'" :aria-label="readmeFullscreen ? '退出全屏' : '全屏查看'" @click="readmeFullscreen = !readmeFullscreen"><Minimize2 v-if="readmeFullscreen" :size="18" aria-hidden="true" /><Maximize2 v-else :size="18" aria-hidden="true" /></button><button class="icon-button" type="button" title="关闭详情" aria-label="关闭详情" @click="closeReadme"><X :size="19" aria-hidden="true" /></button></div></header><div class="modal-meta"><span class="status" :data-status="data.selectedItem.status">{{ data.statusLabel(data.selectedItem.status) }}</span><span>排名 #{{ data.selectedItem.rank }}</span><span>{{ data.formatTime(data.selectedItem.readAt) }}</span><span class="modal-url">{{ data.selectedItem.projectUrl }}</span></div><div class="modal-body"><div v-if="data.selectedItem.errorCode" class="modal-error"><AlertCircle :size="17" aria-hidden="true" /><span>读取失败：{{ data.selectedItem.errorCode }}</span></div><iframe v-if="previewSrcdoc" class="readme-frame" :srcdoc="previewSrcdoc" sandbox="" title="README 预览"></iframe><pre v-else class="readme-text">{{ data.selectedItem.readmeText || '没有可展示的 README 内容。' }}</pre></div></section></div></Teleport>
  </div>
</template>
