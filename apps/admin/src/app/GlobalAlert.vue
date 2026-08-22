<script setup lang="ts">
import { AlertCircle, X } from "lucide-vue-next";

defineProps<{ message: string }>();
defineEmits<{ close: [] }>();
</script>

<template>
  <div class="alert" role="alert">
    <AlertCircle :size="18" aria-hidden="true" />
    <span>{{ message }}</span>
    <button type="button" title="关闭错误提示" aria-label="关闭错误提示" @click="$emit('close')">
      <X :size="17" aria-hidden="true" />
    </button>
  </div>
</template>
