<script setup lang="ts">
import { KeyRound, Network, RefreshCw, Save, Trash2 } from "lucide-vue-next";
import type { NotificationChannel } from "../../admin-models";

defineProps<{
  selectedChannel: NotificationChannel | null;
  form: {
    name: string;
    botToken: string;
    proxyUrl: string;
    proxyEnabled: boolean;
    enabled: boolean;
  };
  loading: boolean;
}>();

const emit = defineEmits<{
  save: [];
  clearProxy: [];
  delete: [];
  verify: [];
}>();
</script>

<template>
  <form class="channel-form" @submit.prevent="emit('save')">
    <div class="form-section-heading">
      <div>
        <span class="eyebrow">BOT SETTINGS</span>
        <h3>机器人配置</h3>
      </div>
      <span>保存时会调用 Telegram 验证凭据。</span>
    </div>
    <div class="channel-form-grid">
      <label>渠道名称<input v-model="form.name" type="text" placeholder="例如：运营日报 Bot" required /></label>
      <label>
        Bot Token
        <div class="secret-input">
          <KeyRound :size="16" />
          <input
            v-model="form.botToken"
            type="password"
            autocomplete="new-password"
            :required="!selectedChannel"
            :placeholder="
              selectedChannel ? `已保存 ${selectedChannel.bot_token_hint}，留空不替换` : '粘贴 BotFather 提供的 Token'
            "
          />
        </div>
        <small>
          {{ selectedChannel ? `当前 Token：${selectedChannel.bot_token_hint}` : "Token 不会回显到管理端。" }}
        </small>
      </label>
    </div>

    <section class="proxy-settings">
      <div class="form-section-heading">
        <div>
          <span class="eyebrow">OPTIONAL ROUTING</span>
          <h3>Telegram 代理</h3>
        </div>
        <span>默认关闭，所有 Telegram 请求统一使用。</span>
      </div>
      <label class="checkbox-label"><input v-model="form.proxyEnabled" type="checkbox" /><span>启用代理</span></label>
      <label>
        代理 URL
        <div class="secret-input">
          <Network :size="16" />
          <input
            v-model="form.proxyUrl"
            type="text"
            autocomplete="off"
            :required="form.proxyEnabled && !selectedChannel?.proxy_configured"
            :placeholder="
              selectedChannel?.proxy_configured
                ? `已保存 ${selectedChannel.proxy_url_hint || '代理配置'}，留空不替换`
                : 'http://、https:// 或 socks5://'
            "
          />
        </div>
        <small>支持 HTTP、HTTPS、SOCKS5。代理 URL 不加密保存，仅在页面展示脱敏的协议、主机和端口。</small>
      </label>
      <div v-if="selectedChannel?.proxy_configured" class="proxy-configured-row">
        <span><Network :size="14" />当前配置：{{ selectedChannel.proxy_url_hint || "已配置代理" }}</span>
        <button class="text-button danger-text" type="button" :disabled="loading" @click="emit('clearProxy')">
          <Trash2 :size="13" />清空配置
        </button>
      </div>
      <small class="proxy-retention-note">关闭代理会立即恢复直连，但不会删除已保存配置。</small>
    </section>

    <label class="checkbox-label"><input v-model="form.enabled" type="checkbox" /><span>启用日报自动推送</span></label>
    <div v-if="selectedChannel?.last_error" class="provider-health provider-health-error">
      <strong>最近验证或发送失败</strong><span>{{ selectedChannel.last_error }}</span>
    </div>
    <div v-else-if="selectedChannel?.last_verified_at" class="provider-health">
      <strong>{{ selectedChannel.bot_display_name || selectedChannel.bot_username || "Telegram Bot" }}</strong>
      <span>
        最近验证：{{ new Date(selectedChannel.last_verified_at).toLocaleString("zh-CN", { hour12: false }) }}
      </span>
    </div>
    <div class="model-form-actions">
      <button v-if="selectedChannel" class="danger-button" type="button" :disabled="loading" @click="emit('delete')">
        <Trash2 :size="15" />删除 Bot
      </button>
      <span></span>
      <div class="channel-actions">
        <button
          v-if="selectedChannel"
          class="secondary-button"
          type="button"
          :disabled="loading"
          @click="emit('verify')"
        >
          <RefreshCw :size="15" :class="{ spinning: loading }" /><span>重新验证</span>
        </button>
        <button class="primary-button" type="submit" :disabled="loading">
          <RefreshCw v-if="loading" :size="15" class="spinning" /><Save v-else :size="15" />
          <span>{{ loading ? "保存中" : "保存 Bot" }}</span>
        </button>
      </div>
    </div>
  </form>
</template>
