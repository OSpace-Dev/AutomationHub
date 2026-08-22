import { ref } from "vue";
import type { NotificationChannel, NotificationTarget, TelegramChat } from "./admin-models";
import { apiFetch } from "./useAdminData";

const channels = ref<NotificationChannel[]>([]);
const selectedChannel = ref<NotificationChannel | null>(null);
const targets = ref<NotificationTarget[]>([]);
const channelLoading = ref(false);
const targetLoading = ref(false);
const channelActionLoading = ref(false);
const targetActionLoading = ref(false);
const channelError = ref("");
const channelForm = ref({ name: "", botToken: "", proxyUrl: "", proxyEnabled: false, enabled: true });
const targetForm = ref({ name: "", chatId: "", enabled: true });
const editingTargetId = ref("");
const testingTargetId = ref("");
const chats = ref<TelegramChat[]>([]);
const chatLoading = ref(false);
const testingChatId = ref("");

export function useChannelsData() {
  return {
    channels,
    selectedChannel,
    targets,
    channelLoading,
    targetLoading,
    channelActionLoading,
    targetActionLoading,
    channelError,
    channelForm,
    targetForm,
    editingTargetId,
    testingTargetId,
    chats,
    chatLoading,
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
  };
}

async function refreshChannels() {
  channelLoading.value = true;
  channelError.value = "";
  try {
    const response = await apiFetch<NotificationChannel[]>("/api/v1/admin/notification-channels");
    channels.value = response.data;
    if (selectedChannel.value) {
      const refreshed = channels.value.find((channel) => channel.id === selectedChannel.value?.id);
      if (refreshed) await selectChannel(refreshed);
      else newChannel();
    } else if (channels.value.length) {
      await selectChannel(channels.value[0]);
    }
  } catch (error) {
    channelError.value = error instanceof Error ? error.message : "通知渠道读取失败。";
  } finally {
    channelLoading.value = false;
  }
}

async function selectChannel(channel: NotificationChannel) {
  selectedChannel.value = channel;
  chats.value = [];
  channelForm.value = {
    name: channel.name,
    botToken: "",
    proxyUrl: "",
    proxyEnabled: channel.proxy_enabled,
    enabled: channel.enabled
  };
  editingTargetId.value = "";
  newTarget();
  targetLoading.value = true;
  channelError.value = "";
  try {
    const response = await apiFetch<NotificationTarget[]>(`/api/v1/admin/notification-channels/${encodeURIComponent(channel.id)}/targets`);
    targets.value = response.data;
  } catch (error) {
    channelError.value = error instanceof Error ? error.message : "Telegram 目标读取失败。";
  } finally {
    targetLoading.value = false;
  }
}

function newChannel() {
  selectedChannel.value = null;
  targets.value = [];
  chats.value = [];
  channelForm.value = { name: "", botToken: "", proxyUrl: "", proxyEnabled: false, enabled: true };
  newTarget();
}

async function saveChannel() {
  if (channelForm.value.proxyEnabled && !channelForm.value.proxyUrl && !selectedChannel.value?.proxy_configured) {
    channelError.value = "启用 Telegram 代理前需要填写代理 URL。";
    return;
  }
  channelActionLoading.value = true;
  channelError.value = "";
  try {
    const response = await apiFetch<NotificationChannel>(
      selectedChannel.value
        ? `/api/v1/admin/notification-channels/${encodeURIComponent(selectedChannel.value.id)}`
        : "/api/v1/admin/notification-channels",
      {
        method: selectedChannel.value ? "PUT" : "POST",
        body: JSON.stringify({
          name: channelForm.value.name,
          bot_token: channelForm.value.botToken || undefined,
          proxy_url: channelForm.value.proxyUrl || undefined,
          proxy_enabled: channelForm.value.proxyEnabled,
          enabled: channelForm.value.enabled,
          ...(selectedChannel.value ? {} : { type: "telegram" })
        })
      }
    );
    channelForm.value.botToken = "";
    channelForm.value.proxyUrl = "";
    await refreshChannels();
    await selectChannel(response.data);
  } catch (error) {
    channelError.value = error instanceof Error ? error.message : "Telegram 渠道保存失败。";
  } finally {
    channelActionLoading.value = false;
  }
}

async function clearProxy() {
  if (!selectedChannel.value?.proxy_configured || !window.confirm("清空后需要重新填写代理 URL 才能再次启用。确认清空吗？")) return;
  channelActionLoading.value = true;
  channelError.value = "";
  try {
    const response = await apiFetch<NotificationChannel>(
      `/api/v1/admin/notification-channels/${encodeURIComponent(selectedChannel.value.id)}`,
      {
        method: "PUT",
        body: JSON.stringify({ proxy_url: "", proxy_enabled: false })
      }
    );
    await refreshChannels();
    await selectChannel(response.data);
  } catch (error) {
    channelError.value = error instanceof Error ? error.message : "Telegram 代理配置清空失败。";
  } finally {
    channelActionLoading.value = false;
  }
}

async function deleteChannel() {
  if (!selectedChannel.value || !window.confirm("删除该 Bot 会同时删除它的 chat 目标，历史日报记录会保留。确认继续吗？")) return;
  channelActionLoading.value = true;
  channelError.value = "";
  try {
    await apiFetch(`/api/v1/admin/notification-channels/${encodeURIComponent(selectedChannel.value.id)}`, { method: "DELETE" });
    newChannel();
    await refreshChannels();
  } catch (error) {
    channelError.value = error instanceof Error ? error.message : "Telegram 渠道删除失败。";
  } finally {
    channelActionLoading.value = false;
  }
}

async function verifyChannel() {
  if (!selectedChannel.value) return;
  channelActionLoading.value = true;
  channelError.value = "";
  try {
    const response = await apiFetch<NotificationChannel>(`/api/v1/admin/notification-channels/${encodeURIComponent(selectedChannel.value.id)}:verify`, { method: "POST" });
    selectedChannel.value = response.data;
    const index = channels.value.findIndex((channel) => channel.id === response.data.id);
    if (index >= 0) channels.value[index] = response.data;
  } catch (error) {
    channelError.value = error instanceof Error ? error.message : "Telegram Bot 验证失败。";
  } finally {
    channelActionLoading.value = false;
  }
}

function newTarget() {
  editingTargetId.value = "";
  targetForm.value = { name: "", chatId: "", enabled: true };
}

function editTarget(target: NotificationTarget) {
  editingTargetId.value = target.id;
  targetForm.value = { name: target.name, chatId: target.chat_id, enabled: target.enabled };
}

async function saveTarget() {
  if (!selectedChannel.value) return;
  targetActionLoading.value = true;
  channelError.value = "";
  try {
    const path = `/api/v1/admin/notification-channels/${encodeURIComponent(selectedChannel.value.id)}/targets`;
    await apiFetch<NotificationTarget>(editingTargetId.value ? `${path}/${encodeURIComponent(editingTargetId.value)}` : path, {
      method: editingTargetId.value ? "PUT" : "POST",
      body: JSON.stringify({ name: targetForm.value.name, chat_id: targetForm.value.chatId, enabled: targetForm.value.enabled })
    });
    newTarget();
    await selectChannel(selectedChannel.value);
  } catch (error) {
    channelError.value = error instanceof Error ? error.message : "Telegram 目标保存失败。";
  } finally {
    targetActionLoading.value = false;
  }
}

async function deleteTarget(target: NotificationTarget) {
  if (!selectedChannel.value || !window.confirm(`确认删除目标“${target.name}”吗？`)) return;
  targetActionLoading.value = true;
  channelError.value = "";
  try {
    await apiFetch(`/api/v1/admin/notification-channels/${encodeURIComponent(selectedChannel.value.id)}/targets/${encodeURIComponent(target.id)}`, { method: "DELETE" });
    if (editingTargetId.value === target.id) newTarget();
    await selectChannel(selectedChannel.value);
  } catch (error) {
    channelError.value = error instanceof Error ? error.message : "Telegram 目标删除失败。";
  } finally {
    targetActionLoading.value = false;
  }
}

async function testTarget(target: NotificationTarget) {
  if (!selectedChannel.value) return;
  testingTargetId.value = target.id;
  channelError.value = "";
  try {
    await apiFetch(`/api/v1/admin/notification-channels/${encodeURIComponent(selectedChannel.value.id)}/targets/${encodeURIComponent(target.id)}:test`, { method: "POST" });
  } catch (error) {
    channelError.value = error instanceof Error ? error.message : "Telegram 测试消息发送失败。";
  } finally {
    testingTargetId.value = "";
  }
}

async function discoverChats() {
  if (!selectedChannel.value) return;
  chatLoading.value = true;
  channelError.value = "";
  try {
    const response = await apiFetch<TelegramChat[]>(
      `/api/v1/admin/notification-channels/${encodeURIComponent(selectedChannel.value.id)}/chats`
    );
    chats.value = response.data;
  } catch (error) {
    channelError.value = error instanceof Error ? error.message : "Telegram 会话读取失败。";
  } finally {
    chatLoading.value = false;
  }
}

function selectChat(chat: TelegramChat) {
  editingTargetId.value = "";
  targetForm.value = {
    name: chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username || `Telegram ${chat.type}`,
    chatId: chat.id,
    enabled: true
  };
}

async function testChat(chat: TelegramChat) {
  if (!selectedChannel.value) return;
  testingChatId.value = chat.id;
  channelError.value = "";
  try {
    await apiFetch(
      `/api/v1/admin/notification-channels/${encodeURIComponent(selectedChannel.value.id)}/chats/${encodeURIComponent(chat.id)}:test`,
      { method: "POST" }
    );
  } catch (error) {
    channelError.value = error instanceof Error ? error.message : "Telegram 测试消息发送失败。";
  } finally {
    testingChatId.value = "";
  }
}
