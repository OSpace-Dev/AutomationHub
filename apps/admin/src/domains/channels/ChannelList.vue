<script setup lang="ts">
import { Plus, RefreshCw, Send } from "lucide-vue-next";
import type { NotificationChannel } from "../../admin-models";

defineProps<{
  channels: NotificationChannel[];
  selectedChannel: NotificationChannel | null;
  loading: boolean;
}>();

const emit = defineEmits<{
  create: [];
  select: [channel: NotificationChannel];
}>();
</script>

<template>
  <aside class="channel-list-panel">
    <div class="workspace-panel-header">
      <div>
        <span class="eyebrow">NOTIFICATION CHANNELS</span>
        <h2>Telegram Bot</h2>
      </div>
      <button
        class="icon-button"
        type="button"
        title="新建 Telegram Bot"
        aria-label="新建 Telegram Bot"
        @click="emit('create')"
      >
        <Plus :size="17" />
      </button>
    </div>
    <div v-if="loading" class="loading-state compact">
      <RefreshCw :size="18" class="spinning" /><span>正在读取渠道</span>
    </div>
    <div v-else-if="!channels.length" class="empty-state compact">
      <Send :size="27" /><strong>尚未配置 Telegram Bot</strong><span>新增 Bot 后即可推送完成日报。</span>
    </div>
    <div v-else class="channel-list">
      <button
        v-for="channel in channels"
        :key="channel.id"
        type="button"
        class="channel-list-item"
        :class="{ selected: selectedChannel?.id === channel.id }"
        @click="emit('select', channel)"
      >
        <span>
          <strong>{{ channel.name }}</strong>
          <span class="status" :data-status="channel.enabled ? 'active' : 'disabled'">
            {{ channel.enabled ? "启用" : "停用" }}
          </span>
        </span>
        <small>{{ channel.bot_username ? `@${channel.bot_username}` : channel.bot_token_hint }}</small>
        <small>{{ channel.last_error || "Token 已安全保存" }}</small>
      </button>
    </div>
  </aside>
</template>
