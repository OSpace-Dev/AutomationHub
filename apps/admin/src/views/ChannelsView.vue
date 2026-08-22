<script setup lang="ts">
import { CheckCircle2, Info, KeyRound, MessageCircle, Network, Plus, RefreshCw, Save, Send, Trash2, UserRound, X } from "lucide-vue-next";
import { onMounted, ref } from "vue";
import type { TelegramChat } from "../admin-models";
import { useChannelsData } from "../useChannelsData";

const {
  channels, selectedChannel, targets, chats, channelLoading, targetLoading, chatLoading,
  channelActionLoading, targetActionLoading, channelError, channelForm, targetForm,
  editingTargetId, testingTargetId, testingChatId, refreshChannels, selectChannel,
  newChannel, saveChannel, clearProxy, deleteChannel, verifyChannel, newTarget, editTarget,
  saveTarget, deleteTarget, testTarget, discoverChats, testChat, selectChat
} = useChannelsData();

onMounted(() => { void refreshChannels(); });
const activeSection = ref<"bot" | "targets">("bot");
const targetDrawerOpen = ref(false);

function chatName(chat: TelegramChat): string {
  return chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(" ") || (chat.username ? `@${chat.username}` : `Telegram ${chat.type}`);
}

function chatDescription(chat: TelegramChat): string {
  return [chat.type, chat.username ? `@${chat.username}` : ""].filter(Boolean).join(" · ");
}
function openNewTarget() { newTarget(); targetDrawerOpen.value = true; }
function openTarget(target: Parameters<typeof editTarget>[0]) { editTarget(target); targetDrawerOpen.value = true; }
function openChatTarget(chat: TelegramChat) { selectChat(chat); targetDrawerOpen.value = true; }
async function submitTarget() { if (await saveTarget()) targetDrawerOpen.value = false; }
function startNewChannel() { targetDrawerOpen.value = false; activeSection.value = "bot"; newChannel(); }
async function openChannel(channel: Parameters<typeof selectChannel>[0]) { targetDrawerOpen.value = false; activeSection.value = "bot"; await selectChannel(channel); }
</script>

<template>
  <section class="channels-workspace">
    <aside class="channel-list-panel">
      <div class="workspace-panel-header">
        <div><span class="eyebrow">NOTIFICATION CHANNELS</span><h2>Telegram Bot</h2></div>
        <button class="icon-button" type="button" title="新建 Telegram Bot" aria-label="新建 Telegram Bot" @click="startNewChannel"><Plus :size="17" /></button>
      </div>
      <div v-if="channelLoading" class="loading-state compact"><RefreshCw :size="18" class="spinning" /><span>正在读取渠道</span></div>
      <div v-else-if="!channels.length" class="empty-state compact"><Send :size="27" /><strong>尚未配置 Telegram Bot</strong><span>新增 Bot 后即可推送完成日报。</span></div>
      <div v-else class="channel-list">
        <button v-for="channel in channels" :key="channel.id" type="button" class="channel-list-item" :class="{ selected: selectedChannel?.id === channel.id }" @click="openChannel(channel)">
          <span><strong>{{ channel.name }}</strong><span class="status" :data-status="channel.enabled ? 'active' : 'disabled'">{{ channel.enabled ? '启用' : '停用' }}</span></span>
          <small>{{ channel.bot_username ? `@${channel.bot_username}` : channel.bot_token_hint }}</small>
          <small>{{ channel.last_error || 'Token 已安全保存' }}</small>
        </button>
      </div>
    </aside>

    <section class="channel-editor-panel">
      <div class="workspace-panel-header channel-editor-header">
        <div><span class="eyebrow">TELEGRAM OUTBOUND</span><h2>{{ selectedChannel ? '编辑 Telegram Bot' : '新增 Telegram Bot' }}</h2><p>Bot Token 只在服务端加密保存，代理 URL 按原值保存但不会在页面回显凭据。</p></div>
        <span v-if="selectedChannel?.last_verified_at" class="default-badge"><CheckCircle2 :size="14" />已验证</span>
      </div>
      <div v-if="channelError" class="inline-error" role="alert" aria-live="polite"><span>{{ channelError }}</span><button type="button" title="关闭错误提示" aria-label="关闭错误提示" @click="channelError = ''"><X :size="16" /></button></div>
      <el-tabs v-model="activeSection" class="channel-tabs">
        <el-tab-pane label="Bot 设置" name="bot" />
        <el-tab-pane label="推送目标" name="targets" :disabled="!selectedChannel" />
      </el-tabs>
      <div class="channel-editor-scroll">
        <form v-if="activeSection === 'bot'" class="channel-form" @submit.prevent="saveChannel">
          <div class="form-section-heading"><div><span class="eyebrow">BOT SETTINGS</span><h3>机器人配置</h3></div><span>保存时会调用 Telegram 验证凭据。</span></div>
          <div class="channel-form-grid">
            <label>渠道名称<input v-model="channelForm.name" type="text" placeholder="例如：运营日报 Bot" required /></label>
            <label>Bot Token<div class="secret-input"><KeyRound :size="16" /><input v-model="channelForm.botToken" type="password" autocomplete="new-password" :required="!selectedChannel" :placeholder="selectedChannel ? `已保存 ${selectedChannel.bot_token_hint}，留空不替换` : '粘贴 BotFather 提供的 Token'" /></div><small>{{ selectedChannel ? `当前 Token：${selectedChannel.bot_token_hint}` : 'Token 不会回显到管理端。' }}</small></label>
          </div>

          <section class="proxy-settings">
            <div class="form-section-heading"><div><span class="eyebrow">OPTIONAL ROUTING</span><h3>Telegram 代理</h3></div><span>默认关闭，所有 Telegram 请求统一使用。</span></div>
            <label class="checkbox-label"><input v-model="channelForm.proxyEnabled" type="checkbox" /><span>启用代理</span></label>
            <label>代理 URL<div class="secret-input"><Network :size="16" /><input v-model="channelForm.proxyUrl" type="text" autocomplete="off" :required="channelForm.proxyEnabled && !selectedChannel?.proxy_configured" :placeholder="selectedChannel?.proxy_configured ? `已保存 ${selectedChannel.proxy_url_hint || '代理配置'}，留空不替换` : 'http://、https:// 或 socks5://'" /></div><small>支持 HTTP、HTTPS、SOCKS5。代理 URL 不加密保存，仅在页面展示脱敏的协议、主机和端口。</small></label>
            <div v-if="selectedChannel?.proxy_configured" class="proxy-configured-row">
              <span><Network :size="14" />当前配置：{{ selectedChannel.proxy_url_hint || '已配置代理' }}</span>
              <button class="text-button danger-text" type="button" :disabled="channelActionLoading" @click="clearProxy"><Trash2 :size="13" />清空配置</button>
            </div>
            <small class="proxy-retention-note">关闭代理会立即恢复直连，但不会删除已保存配置。</small>
          </section>

          <label class="checkbox-label"><input v-model="channelForm.enabled" type="checkbox" /><span>启用日报自动推送</span></label>
          <div v-if="selectedChannel?.last_error" class="provider-health provider-health-error"><strong>最近验证或发送失败</strong><span>{{ selectedChannel.last_error }}</span></div>
          <div v-else-if="selectedChannel?.last_verified_at" class="provider-health"><strong>{{ selectedChannel.bot_display_name || selectedChannel.bot_username || 'Telegram Bot' }}</strong><span>最近验证：{{ new Date(selectedChannel.last_verified_at).toLocaleString('zh-CN', { hour12: false }) }}</span></div>
          <div class="model-form-actions">
            <button v-if="selectedChannel" class="danger-button" type="button" :disabled="channelActionLoading" @click="deleteChannel"><Trash2 :size="15" />删除 Bot</button>
            <span></span>
            <div class="channel-actions">
              <button v-if="selectedChannel" class="secondary-button" type="button" :disabled="channelActionLoading" @click="verifyChannel"><RefreshCw :size="15" :class="{ spinning: channelActionLoading }" /><span>重新验证</span></button>
              <button class="primary-button" type="submit" :disabled="channelActionLoading"><RefreshCw v-if="channelActionLoading" :size="15" class="spinning" /><Save v-else :size="15" /><span>{{ channelActionLoading ? '保存中' : '保存 Bot' }}</span></button>
            </div>
          </div>
        </form>

        <section v-else-if="selectedChannel" class="target-section">
          <div class="target-section-header">
            <div><span class="eyebrow">CHAT TARGETS</span><h3>会话与推送目标</h3><p>日报将以紧凑摘要推送，并附完整的公开阅读链接。</p></div>
            <button class="secondary-button" type="button" :disabled="chatLoading" @click="discoverChats"><RefreshCw v-if="chatLoading" :size="15" class="spinning" /><MessageCircle v-else :size="15" /><span>{{ chatLoading ? '读取中' : '读取会话' }}</span></button>
          </div>

          <div class="chat-guide"><UserRound :size="17" /><div><strong>不知道 chat ID？</strong><span>在 Telegram 中向 Bot 发消息（私聊可发送 /start），或在群组/频道里让 Bot 收到一条消息，然后点击“读取会话”。启用 webhook 的 Bot 无法使用此功能。</span></div></div>

          <div v-if="chatLoading" class="loading-state compact"><RefreshCw :size="17" class="spinning" /><span>正在向 Telegram 读取最近会话</span></div>
          <div v-else-if="chats.length" class="chat-discovery-list">
            <div v-for="chat in chats" :key="chat.id" class="chat-discovery-row">
              <div class="chat-discovery-icon"><MessageCircle :size="17" /></div>
              <div class="chat-discovery-main"><strong>{{ chatName(chat) }}</strong><small>{{ chat.id }} · {{ chatDescription(chat) }}</small></div>
              <span v-if="chat.already_configured" class="status" data-status="active">已添加</span>
              <div class="chat-row-actions">
                <button class="text-button" type="button" @click="openChatTarget(chat)"><Plus :size="13" />{{ chat.already_configured ? '重新填写' : '选择' }}</button>
                <button class="text-button" type="button" :disabled="testingChatId === chat.id" @click="testChat(chat)"><RefreshCw v-if="testingChatId === chat.id" :size="13" class="spinning" /><Send v-else :size="13" />测试推送</button>
              </div>
            </div>
          </div>
          <div v-else class="chat-empty"><MessageCircle :size="21" /><div><strong>还没有读取到会话</strong><span>读取结果只包含 Bot 已经收到过更新的会话，不会扫描 Telegram 账号的全部聊天。</span></div></div>

          <div class="configured-targets">
            <div class="configured-targets-heading"><div><span class="eyebrow">CONFIGURED TARGETS</span><h3>已添加目标</h3></div><button class="secondary-button" type="button" @click="openNewTarget"><Plus :size="15" /><span>手动添加</span></button></div>
            <div v-if="targetLoading" class="loading-state compact"><RefreshCw :size="17" class="spinning" /><span>正在读取目标</span></div>
            <div v-else-if="!targets.length" class="chat-empty compact"><Send :size="21" /><div><strong>还没有推送目标</strong><span>从上方会话选择，或手动填写 chat ID。</span></div></div>
            <div v-else class="target-list">
              <div v-for="target in targets" :key="target.id" class="target-row">
                <div><strong>{{ target.name }}</strong><small>{{ target.chat_id }}</small></div>
                <span class="status" :data-status="target.enabled ? 'active' : 'disabled'">{{ target.enabled ? '启用' : '停用' }}</span>
                <div class="target-row-actions"><button class="text-button" type="button" @click="openTarget(target)">编辑</button><button class="text-button" type="button" :disabled="testingTargetId === target.id" @click="testTarget(target)"><RefreshCw v-if="testingTargetId === target.id" :size="13" class="spinning" /><Send v-else :size="13" />测试推送</button><button class="text-button danger-text" type="button" @click="deleteTarget(target)">删除</button></div>
              </div>
            </div>
          </div>

        </section>
      </div>
    </section>

    <el-drawer v-model="targetDrawerOpen" :title="editingTargetId ? '编辑推送目标' : '添加推送目标'" size="min(520px, 100%)" class="admin-drawer" :close-on-click-modal="!targetActionLoading" :close-on-press-escape="!targetActionLoading">
      <form class="drawer-form target-drawer-form" @submit.prevent="submitTarget"><div class="drawer-intro"><span class="drawer-icon"><Send :size="18" /></span><div><strong>{{ editingTargetId ? '更新 Telegram 目标' : '配置 Telegram 目标' }}</strong><span>保存后返回当前 Bot 的目标列表，并保留已读取会话。</span></div></div><div v-if="channelError" class="inline-error" role="alert" aria-live="polite">{{ channelError }}</div><label>目标名称<input v-model="targetForm.name" type="text" placeholder="例如：日报群" required /></label><label>chat_id<input v-model="targetForm.chatId" type="text" placeholder="例如：-1001234567890" required /></label><p class="target-form-help"><Info :size="14" aria-hidden="true" /><span>可手动填写，也可以从“推送目标”标签读取的会话中选择。</span></p><label class="checkbox-label"><input v-model="targetForm.enabled" type="checkbox" /><span>启用该目标</span></label></form>
      <template #footer><div class="drawer-footer"><el-button :disabled="targetActionLoading" @click="targetDrawerOpen = false">取消</el-button><el-button type="primary" :loading="targetActionLoading" :disabled="!targetForm.name.trim() || !targetForm.chatId.trim()" @click="submitTarget"><Save v-if="!targetActionLoading" :size="15" />保存目标</el-button></div></template>
    </el-drawer>
  </section>
</template>
