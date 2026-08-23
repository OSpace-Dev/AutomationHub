<script setup lang="ts">
import { RefreshCw } from "lucide-vue-next";
import AdminKeyCard from "./AdminKeyCard.vue";

defineProps<{
  ready: boolean;
  authenticated: boolean;
  apiKey: string;
  error: string;
  loading: boolean;
}>();

const emit = defineEmits<{
  "update:apiKey": [value: string];
  login: [];
}>();
</script>

<template>
  <main v-if="!ready" class="auth-gate auth-gate-loading" aria-live="polite">
    <RefreshCw :size="20" class="spinning" aria-hidden="true" />
    <span>正在连接管理服务</span>
  </main>
  <main v-else-if="!authenticated" class="auth-gate">
    <AdminKeyCard
      title="管理后台"
      heading-id="admin-login-title"
      description="本地开发默认无需管理 Key；受保护部署请输入密钥继续。"
      brand-subtitle="采集管理"
      :api-key="apiKey"
      :error="error"
      :loading="loading"
      submit-label="进入管理后台"
      loading-label="验证中"
      autofocus
      @update:api-key="emit('update:apiKey', $event)"
      @submit="emit('login')"
    />
  </main>
</template>
