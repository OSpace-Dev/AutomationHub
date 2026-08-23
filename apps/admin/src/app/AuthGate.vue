<script setup lang="ts">
import { AlertCircle, KeyRound, LockKeyhole, RefreshCw } from "lucide-vue-next";

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
    <section class="auth-card" aria-labelledby="admin-login-title">
      <div class="auth-brand">
        <span class="brand-mark">AH</span>
        <div>
          <strong>AutomationHub</strong>
          <span>采集管理</span>
        </div>
      </div>
      <div class="auth-heading">
        <span class="eyebrow">ADMIN ACCESS</span>
        <h1 id="admin-login-title">管理后台</h1>
        <p>本地开发默认无需管理 Key；受保护部署请输入密钥继续。</p>
      </div>
      <form class="auth-form" @submit.prevent="emit('login')">
        <label class="auth-field">
          <span>管理 Key</span>
          <div class="auth-input">
            <KeyRound :size="17" class="auth-input-icon" aria-hidden="true" />
            <el-input
              :model-value="apiKey"
              type="password"
              autocomplete="current-password"
              autofocus
              placeholder="输入管理 Key"
              show-password
              @update:model-value="emit('update:apiKey', $event)"
            />
          </div>
        </label>
        <div v-if="error" class="auth-error" role="alert">
          <AlertCircle :size="16" aria-hidden="true" />
          <span>{{ error }}</span>
        </div>
        <el-button class="auth-submit" type="primary" native-type="submit" :loading="loading">
          <LockKeyhole v-if="!loading" :size="16" aria-hidden="true" />
          <span>{{ loading ? "验证中" : "进入管理后台" }}</span>
        </el-button>
      </form>
    </section>
  </main>
</template>
