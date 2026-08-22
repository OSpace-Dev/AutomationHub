<script setup lang="ts">
import { CheckCircle2, X } from "lucide-vue-next";
import { onMounted, ref } from "vue";
import type { TelegramChat } from "../admin-models";
import ChannelBotForm from "../domains/channels/ChannelBotForm.vue";
import ChannelList from "../domains/channels/ChannelList.vue";
import ChannelTargetDrawer from "../domains/channels/ChannelTargetDrawer.vue";
import ChannelTargetsWorkspace from "../domains/channels/ChannelTargetsWorkspace.vue";
import { useChannelsData } from "../useChannelsData";

const {
  channels,
  selectedChannel,
  targets,
  chats,
  channelLoading,
  targetLoading,
  chatLoading,
  channelActionLoading,
  targetActionLoading,
  channelError,
  channelForm,
  targetForm,
  editingTargetId,
  testingTargetId,
  testingChatId,
  refreshChannels,
  selectChannel,
  newChannel,
  saveChannel,
  clearProxy,
  deleteChannel,
  verifyChannel,
  newTarget,
  editTarget,
  saveTarget,
  deleteTarget,
  testTarget,
  discoverChats,
  testChat,
  selectChat
} = useChannelsData();

onMounted(() => {
  void refreshChannels();
});
const activeSection = ref<"bot" | "targets">("bot");
const targetDrawerOpen = ref(false);
function openNewTarget() {
  newTarget();
  targetDrawerOpen.value = true;
}
function openTarget(target: Parameters<typeof editTarget>[0]) {
  editTarget(target);
  targetDrawerOpen.value = true;
}
function openChatTarget(chat: TelegramChat) {
  selectChat(chat);
  targetDrawerOpen.value = true;
}
async function submitTarget() {
  if (await saveTarget()) targetDrawerOpen.value = false;
}
function startNewChannel() {
  targetDrawerOpen.value = false;
  activeSection.value = "bot";
  newChannel();
}
async function openChannel(channel: Parameters<typeof selectChannel>[0]) {
  targetDrawerOpen.value = false;
  activeSection.value = "bot";
  await selectChannel(channel);
}
</script>

<template>
  <section class="channels-workspace">
    <ChannelList
      :channels="channels"
      :selected-channel="selectedChannel"
      :loading="channelLoading"
      @create="startNewChannel"
      @select="openChannel"
    />

    <section class="channel-editor-panel">
      <div class="workspace-panel-header channel-editor-header">
        <div>
          <span class="eyebrow">TELEGRAM OUTBOUND</span>
          <h2>{{ selectedChannel ? "编辑 Telegram Bot" : "新增 Telegram Bot" }}</h2>
          <p>Bot Token 只在服务端加密保存，代理 URL 按原值保存但不会在页面回显凭据。</p>
        </div>
        <span v-if="selectedChannel?.last_verified_at" class="default-badge"><CheckCircle2 :size="14" />已验证</span>
      </div>
      <div v-if="channelError" class="inline-error" role="alert" aria-live="polite">
        <span>{{ channelError }}</span
        ><button type="button" title="关闭错误提示" aria-label="关闭错误提示" @click="channelError = ''">
          <X :size="16" />
        </button>
      </div>
      <el-tabs v-model="activeSection" class="channel-tabs">
        <el-tab-pane label="Bot 设置" name="bot" />
        <el-tab-pane label="推送目标" name="targets" :disabled="!selectedChannel" />
      </el-tabs>
      <div class="channel-editor-scroll">
        <ChannelBotForm
          v-if="activeSection === 'bot'"
          :selected-channel="selectedChannel"
          :form="channelForm"
          :loading="channelActionLoading"
          @save="saveChannel"
          @clear-proxy="clearProxy"
          @delete="deleteChannel"
          @verify="verifyChannel"
        />
        <ChannelTargetsWorkspace
          v-else-if="selectedChannel"
          :targets="targets"
          :chats="chats"
          :target-loading="targetLoading"
          :chat-loading="chatLoading"
          :testing-target-id="testingTargetId"
          :testing-chat-id="testingChatId"
          @discover-chats="discoverChats"
          @select-chat="openChatTarget"
          @test-chat="testChat"
          @create-target="openNewTarget"
          @edit-target="openTarget"
          @test-target="testTarget"
          @delete-target="deleteTarget"
        />
      </div>
    </section>

    <ChannelTargetDrawer
      v-model:open="targetDrawerOpen"
      :editing-target-id="editingTargetId"
      :form="targetForm"
      :loading="targetActionLoading"
      :error="channelError"
      @submit="submitTarget"
    />
  </section>
</template>
