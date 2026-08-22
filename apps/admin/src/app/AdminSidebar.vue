<script setup lang="ts">
import { Activity, Bot, Database, FileText, Monitor, Send, Wifi } from "lucide-vue-next";
import { RouterLink } from "vue-router";
import type { ConnectionState } from "../admin-models";

defineProps<{
  connectionState: ConnectionState;
  connectionLabel: string;
}>();

const workspaceLinks = [
  { to: "/runs", label: "采集数据", icon: Database },
  { to: "/devices", label: "设备管理", icon: Monitor },
  { to: "/tasks", label: "任务中心", icon: Activity },
  { to: "/monitoring", label: "运行监控", icon: Wifi },
  { to: "/reports", label: "日报中心", icon: FileText }
];

const settingLinks = [
  { to: "/settings/models", label: "模型配置", icon: Bot },
  { to: "/settings/channels", label: "通知渠道", icon: Send }
];
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <span class="brand-mark">AH</span>
      <div>
        <strong>AutomationHub</strong>
        <span>采集管理</span>
      </div>
    </div>
    <span class="nav-label">工作台</span>
    <nav class="primary-nav" aria-label="主导航">
      <RouterLink v-for="link in workspaceLinks" :key="link.to" :to="link.to" custom v-slot="{ navigate, isActive }">
        <button type="button" :class="{ active: isActive }" @click="navigate">
          <component :is="link.icon" :size="18" aria-hidden="true" />
          <span>{{ link.label }}</span>
        </button>
      </RouterLink>
    </nav>
    <span class="nav-label">系统设置</span>
    <nav class="primary-nav" aria-label="系统设置">
      <RouterLink v-for="link in settingLinks" :key="link.to" :to="link.to" custom v-slot="{ navigate, isActive }">
        <button type="button" :class="{ active: isActive }" @click="navigate">
          <component :is="link.icon" :size="18" aria-hidden="true" />
          <span>{{ link.label }}</span>
        </button>
      </RouterLink>
    </nav>
    <div class="sidebar-status" :data-state="connectionState">
      <Wifi :size="16" aria-hidden="true" />
      <div>
        <span>API 状态</span>
        <strong>{{ connectionLabel }}</strong>
      </div>
    </div>
  </aside>
</template>
