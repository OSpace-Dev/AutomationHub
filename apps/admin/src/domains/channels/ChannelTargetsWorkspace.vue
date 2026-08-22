<script setup lang="ts">
import { MessageCircle, Plus, RefreshCw, Send, UserRound } from "lucide-vue-next";
import type { NotificationTarget, TelegramChat } from "../../admin-models";

defineProps<{
  targets: NotificationTarget[];
  chats: TelegramChat[];
  targetLoading: boolean;
  chatLoading: boolean;
  testingTargetId: string;
  testingChatId: string;
}>();

const emit = defineEmits<{
  discoverChats: [];
  selectChat: [chat: TelegramChat];
  testChat: [chat: TelegramChat];
  createTarget: [];
  editTarget: [target: NotificationTarget];
  testTarget: [target: NotificationTarget];
  deleteTarget: [target: NotificationTarget];
}>();

function chatName(chat: TelegramChat): string {
  return (
    chat.title ||
    [chat.first_name, chat.last_name].filter(Boolean).join(" ") ||
    (chat.username ? `@${chat.username}` : `Telegram ${chat.type}`)
  );
}

function chatDescription(chat: TelegramChat): string {
  return [chat.type, chat.username ? `@${chat.username}` : ""].filter(Boolean).join(" · ");
}
</script>

<template>
  <section class="target-section">
    <div class="target-section-header">
      <div>
        <span class="eyebrow">CHAT TARGETS</span>
        <h3>会话与推送目标</h3>
        <p>日报将以紧凑摘要推送，并附完整的公开阅读链接。</p>
      </div>
      <button class="secondary-button" type="button" :disabled="chatLoading" @click="emit('discoverChats')">
        <RefreshCw v-if="chatLoading" :size="15" class="spinning" /><MessageCircle v-else :size="15" />
        <span>{{ chatLoading ? "读取中" : "读取会话" }}</span>
      </button>
    </div>

    <div class="chat-guide">
      <UserRound :size="17" />
      <div>
        <strong>不知道 chat ID？</strong>
        <span>
          在 Telegram 中向 Bot 发消息（私聊可发送 /start），或在群组/频道里让 Bot 收到一条消息，然后点击“读取会话”。启用
          webhook 的 Bot 无法使用此功能。
        </span>
      </div>
    </div>

    <div v-if="chatLoading" class="loading-state compact">
      <RefreshCw :size="17" class="spinning" /><span>正在向 Telegram 读取最近会话</span>
    </div>
    <div v-else-if="chats.length" class="chat-discovery-list">
      <div v-for="chat in chats" :key="chat.id" class="chat-discovery-row">
        <div class="chat-discovery-icon"><MessageCircle :size="17" /></div>
        <div class="chat-discovery-main">
          <strong>{{ chatName(chat) }}</strong
          ><small>{{ chat.id }} · {{ chatDescription(chat) }}</small>
        </div>
        <span v-if="chat.already_configured" class="status" data-status="active">已添加</span>
        <div class="chat-row-actions">
          <button class="text-button" type="button" @click="emit('selectChat', chat)">
            <Plus :size="13" />{{ chat.already_configured ? "重新填写" : "选择" }}
          </button>
          <button
            class="text-button"
            type="button"
            :disabled="testingChatId === chat.id"
            @click="emit('testChat', chat)"
          >
            <RefreshCw v-if="testingChatId === chat.id" :size="13" class="spinning" /><Send v-else :size="13" />测试推送
          </button>
        </div>
      </div>
    </div>
    <div v-else class="chat-empty">
      <MessageCircle :size="21" />
      <div>
        <strong>还没有读取到会话</strong>
        <span>读取结果只包含 Bot 已经收到过更新的会话，不会扫描 Telegram 账号的全部聊天。</span>
      </div>
    </div>

    <div class="configured-targets">
      <div class="configured-targets-heading">
        <div>
          <span class="eyebrow">CONFIGURED TARGETS</span>
          <h3>已添加目标</h3>
        </div>
        <button class="secondary-button" type="button" @click="emit('createTarget')">
          <Plus :size="15" /><span>手动添加</span>
        </button>
      </div>
      <div v-if="targetLoading" class="loading-state compact">
        <RefreshCw :size="17" class="spinning" /><span>正在读取目标</span>
      </div>
      <div v-else-if="!targets.length" class="chat-empty compact">
        <Send :size="21" />
        <div><strong>还没有推送目标</strong><span>从上方会话选择，或手动填写 chat ID。</span></div>
      </div>
      <div v-else class="target-list">
        <div v-for="target in targets" :key="target.id" class="target-row">
          <div>
            <strong>{{ target.name }}</strong
            ><small>{{ target.chat_id }}</small>
          </div>
          <span class="status" :data-status="target.enabled ? 'active' : 'disabled'">
            {{ target.enabled ? "启用" : "停用" }}
          </span>
          <div class="target-row-actions">
            <button class="text-button" type="button" @click="emit('editTarget', target)">编辑</button>
            <button
              class="text-button"
              type="button"
              :disabled="testingTargetId === target.id"
              @click="emit('testTarget', target)"
            >
              <RefreshCw v-if="testingTargetId === target.id" :size="13" class="spinning" /><Send
                v-else
                :size="13"
              />测试推送
            </button>
            <button class="text-button danger-text" type="button" @click="emit('deleteTarget', target)">删除</button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
