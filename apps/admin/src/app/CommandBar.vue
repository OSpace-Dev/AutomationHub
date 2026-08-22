<script setup lang="ts">
import { RefreshCw, Settings } from "lucide-vue-next";

defineProps<{
  title: string;
  loading: boolean;
  settingsExpanded: boolean;
}>();

defineEmits<{
  refresh: [];
  toggleSettings: [];
}>();
</script>

<template>
  <header class="command-bar">
    <h1>{{ title }}</h1>
    <div class="command-actions">
      <el-button
        class="icon-button"
        native-type="button"
        :loading="loading"
        :disabled="loading"
        title="刷新当前页面"
        aria-label="刷新当前页面"
        @click="$emit('refresh')"
      >
        <RefreshCw :size="18" :class="{ spinning: loading }" aria-hidden="true" />
      </el-button>
      <button
        class="icon-button"
        type="button"
        title="连接设置"
        aria-label="连接设置"
        :aria-expanded="settingsExpanded"
        @click="$emit('toggleSettings')"
      >
        <Settings :size="18" aria-hidden="true" />
      </button>
    </div>
  </header>
</template>
