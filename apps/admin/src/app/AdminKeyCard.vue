<script setup lang="ts">
import { AlertCircle, KeyRound, LockKeyhole } from "lucide-vue-next";

withDefaults(
  defineProps<{
    title: string;
    headingId: string;
    description: string;
    apiKey: string;
    error: string;
    loading: boolean;
    submitLabel?: string;
    loadingLabel?: string;
    brandSubtitle?: string;
    autofocus?: boolean;
  }>(),
  {
    submitLabel: "进入管理后台",
    loadingLabel: "验证中",
    brandSubtitle: "采集管理",
    autofocus: false
  }
);

const emit = defineEmits<{
  "update:apiKey": [value: string];
  submit: [];
}>();
</script>

<template>
  <section class="auth-card" :aria-labelledby="headingId">
    <div class="auth-brand">
      <span class="brand-mark">AH</span>
      <div>
        <strong>AutomationHub</strong>
        <span>{{ brandSubtitle }}</span>
      </div>
    </div>
    <div class="auth-heading">
      <span class="eyebrow">ADMIN ACCESS</span>
      <h1 :id="headingId">{{ title }}</h1>
      <p>{{ description }}</p>
    </div>
    <form class="auth-form" @submit.prevent="emit('submit')">
      <slot name="extra-fields" />
      <label class="auth-field" :for="`${headingId}-key`">
        <span>管理 Key</span>
        <div class="auth-input">
          <KeyRound :size="17" class="auth-input-icon" aria-hidden="true" />
          <el-input
            :id="`${headingId}-key`"
            :model-value="apiKey"
            type="password"
            autocomplete="current-password"
            :autofocus="autofocus"
            placeholder="输入管理 Key"
            show-password
            :disabled="loading"
            @update:model-value="emit('update:apiKey', $event)"
          />
        </div>
      </label>
      <div v-if="error" class="auth-error" role="alert" aria-live="polite">
        <AlertCircle :size="16" aria-hidden="true" />
        <span>{{ error }}</span>
      </div>
      <el-button class="auth-submit" type="primary" native-type="submit" :loading="loading" :disabled="loading">
        <LockKeyhole v-if="!loading" :size="16" aria-hidden="true" />
        <span>{{ loading ? loadingLabel : submitLabel }}</span>
      </el-button>
    </form>
  </section>
</template>
