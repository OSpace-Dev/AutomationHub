<script setup lang="ts">
import { Info, Save, Send } from "lucide-vue-next";

defineProps<{
  open: boolean;
  editingTargetId: string;
  form: {
    name: string;
    chatId: string;
    enabled: boolean;
  };
  loading: boolean;
  error: string;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  submit: [];
}>();
</script>

<template>
  <el-drawer
    :model-value="open"
    :title="editingTargetId ? '编辑推送目标' : '添加推送目标'"
    size="min(520px, 100%)"
    class="admin-drawer"
    append-to-body
    :close-on-click-modal="!loading"
    :close-on-press-escape="!loading"
    @update:model-value="emit('update:open', $event)"
  >
    <form class="drawer-form target-drawer-form" @submit.prevent="emit('submit')">
      <div class="drawer-intro">
        <span class="drawer-icon"><Send :size="18" /></span>
        <div>
          <strong>{{ editingTargetId ? "更新 Telegram 目标" : "配置 Telegram 目标" }}</strong>
          <span>保存后返回当前 Bot 的目标列表，并保留已读取会话。</span>
        </div>
      </div>
      <div v-if="error" class="inline-error" role="alert" aria-live="polite">{{ error }}</div>
      <label>目标名称<input v-model="form.name" type="text" placeholder="例如：日报群" required /></label>
      <label>chat_id<input v-model="form.chatId" type="text" placeholder="例如：-1001234567890" required /></label>
      <p class="target-form-help">
        <Info :size="14" aria-hidden="true" /><span>可手动填写，也可以从“推送目标”标签读取的会话中选择。</span>
      </p>
      <label class="checkbox-label"><input v-model="form.enabled" type="checkbox" /><span>启用该目标</span></label>
    </form>
    <template #footer>
      <div class="drawer-footer">
        <el-button :disabled="loading" @click="emit('update:open', false)">取消</el-button>
        <el-button
          type="primary"
          :loading="loading"
          :disabled="!form.name.trim() || !form.chatId.trim()"
          @click="emit('submit')"
        >
          <Save v-if="!loading" :size="15" />保存目标
        </el-button>
      </div>
    </template>
  </el-drawer>
</template>
