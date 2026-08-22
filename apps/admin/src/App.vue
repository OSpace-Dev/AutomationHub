<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { RouterLink, RouterView, useRoute } from "vue-router";
import { Activity, AlertCircle, Bot, Database, ExternalLink, FileText, KeyRound, LockKeyhole, Maximize2, Minimize2, Monitor, RefreshCw, Send, Server, Settings, Wifi, X } from "lucide-vue-next";
import { useAdminData } from "./useAdminData";
import type { AdminView } from "./useAdminData";

const route = useRoute();
const data = reactive(useAdminData());
const readmeFullscreen = ref(false);
const activeTab = computed<AdminView>(() => (["runs", "devices", "tasks", "monitoring", "reports", "models", "channels"].includes(String(route.name)) ? route.name as AdminView : "runs"));
const pageTitle = computed(() => ({ runs: "每日采集数据", devices: "采集设备", tasks: "任务中心", monitoring: "运行监控", reports: "日报中心", models: "模型配置", channels: "通知渠道" }[activeTab.value]));
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
function loginCurrentView() { return data.login(activeTab.value); }
watch(() => route.name, (name) => {
  closeReadme();
  if (name !== "public-report" && data.isAuthenticated) void data.refreshView(activeTab.value);
});
onMounted(async () => {
  document.addEventListener("keydown", handleKeydown);
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
onUnmounted(() => { document.removeEventListener("keydown", handleKeydown); if (refreshTimer) window.clearInterval(refreshTimer); });
</script>

<template>
  <RouterView v-if="route.name === 'public-report'" />
  <main v-else-if="!data.authReady" class="auth-gate auth-gate-loading" aria-live="polite"><RefreshCw :size="20" class="spinning" aria-hidden="true" /><span>正在连接管理服务</span></main>
  <main v-else-if="!data.isAuthenticated" class="auth-gate"><section class="auth-card" aria-labelledby="admin-login-title"><div class="auth-brand"><span class="brand-mark">AH</span><div><strong>AutomationHub</strong><span>采集管理</span></div></div><div class="auth-heading"><span class="eyebrow">ADMIN ACCESS</span><h1 id="admin-login-title">管理后台</h1><p>请输入管理 Key 以继续访问。</p></div><form class="auth-form" @submit.prevent="loginCurrentView"><label><span>管理 Key</span><div class="auth-input"><KeyRound :size="17" aria-hidden="true" /><el-input v-model="data.adminApiKey" type="password" autocomplete="current-password" autofocus placeholder="输入管理 Key" show-password /></div></label><div v-if="data.loginError" class="auth-error" role="alert"><AlertCircle :size="16" aria-hidden="true" /><span>{{ data.loginError }}</span></div><el-button class="auth-submit" type="primary" native-type="submit" :loading="data.loginLoading"><LockKeyhole v-if="!data.loginLoading" :size="16" aria-hidden="true" /><span>{{ data.loginLoading ? '验证中' : '进入管理后台' }}</span></el-button></form></section></main>
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
        <RouterLink to="/settings/channels" custom v-slot="{ navigate, isActive }"><button type="button" :class="{ active: isActive }" @click="navigate"><Send :size="18" aria-hidden="true" /><span>通知渠道</span></button></RouterLink>
      </nav>
      <div class="sidebar-status" :data-state="data.connectionState"><Wifi :size="16" aria-hidden="true" /><div><span>API 状态</span><strong>{{ data.connectionLabel }}</strong></div></div>
    </aside>

    <main class="main-content"><header class="command-bar"><h1>{{ pageTitle }}</h1><div class="command-actions">
      <el-button class="icon-button" native-type="button" :loading="data.loading" :disabled="data.loading" title="刷新当前页面" aria-label="刷新当前页面" @click="refreshCurrentView"><RefreshCw :size="18" :class="{ spinning: data.loading }" aria-hidden="true" /></el-button>
      <button class="icon-button" type="button" title="连接设置" aria-label="连接设置" :aria-expanded="data.showConnectionSettings" @click="data.showConnectionSettings = !data.showConnectionSettings"><Settings :size="18" aria-hidden="true" /></button>
    </div></header>
      <section v-if="data.showConnectionSettings" class="connection-band" aria-label="管理 API 连接设置"><div class="connection-heading"><Server :size="19" aria-hidden="true" /><div><strong>管理 API</strong><span>本地联调可留空管理密钥</span></div></div><label>API 地址<el-input v-model="data.apiOrigin" type="url" placeholder="http://localhost:3000" /></label><label>管理密钥<el-input v-model="data.adminApiKey" type="password" autocomplete="off" placeholder="受保护部署时填写" show-password /></label><el-button type="primary" :loading="data.loading" @click="connectCurrentView"><RefreshCw v-if="!data.loading" :size="16" aria-hidden="true" /><span>{{ data.loading ? '连接中' : '连接并读取' }}</span></el-button></section>
      <div v-if="data.errorMessage" class="alert" role="alert"><AlertCircle :size="18" aria-hidden="true" /><span>{{ data.errorMessage }}</span><button type="button" title="关闭错误提示" aria-label="关闭错误提示" @click="data.errorMessage = ''"><X :size="17" aria-hidden="true" /></button></div>
      <div class="view-host"><RouterView /></div>
    </main>

    <Teleport to="body"><div v-if="data.selectedItem" class="modal-backdrop" @click.self="closeReadme"><section class="readme-modal" :class="{ fullscreen: readmeFullscreen }" role="dialog" aria-modal="true" aria-labelledby="readme-title"><header><div><span>README 详情</span><h2 id="readme-title">{{ data.selectedItem.name }}</h2></div><div class="modal-actions"><a class="icon-button" :href="data.selectedItem.projectUrl" target="_blank" rel="noreferrer" title="在 GitHub 打开" aria-label="在 GitHub 打开"><ExternalLink :size="18" aria-hidden="true" /></a><button class="icon-button" type="button" :title="readmeFullscreen ? '退出全屏' : '全屏查看'" :aria-label="readmeFullscreen ? '退出全屏' : '全屏查看'" @click="readmeFullscreen = !readmeFullscreen"><Minimize2 v-if="readmeFullscreen" :size="18" aria-hidden="true" /><Maximize2 v-else :size="18" aria-hidden="true" /></button><button class="icon-button" type="button" title="关闭详情" aria-label="关闭详情" @click="closeReadme"><X :size="19" aria-hidden="true" /></button></div></header><div class="modal-meta"><span class="status" :data-status="data.selectedItem.status">{{ data.statusLabel(data.selectedItem.status) }}</span><span>排名 #{{ data.selectedItem.rank }}</span><span>{{ data.formatTime(data.selectedItem.readAt) }}</span><span class="modal-url">{{ data.selectedItem.projectUrl }}</span></div><div class="modal-body"><div v-if="data.selectedItem.errorCode" class="modal-error"><AlertCircle :size="17" aria-hidden="true" /><span>读取失败：{{ data.selectedItem.errorCode }}</span></div><iframe v-if="previewSrcdoc" class="readme-frame" :srcdoc="previewSrcdoc" sandbox="" title="README 预览"></iframe><pre v-else class="readme-text">{{ data.selectedItem.readmeText || '没有可展示的 README 内容。' }}</pre></div></section></div></Teleport>
  </div>
</template>
