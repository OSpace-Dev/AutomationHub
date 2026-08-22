import { invalidPayload } from "../../errors.js";
import type { NotificationTarget } from "../../models.js";
import type { HttpContext } from "../context.js";
import { optionalBoolean, readJson } from "../request.js";
import { writeJson } from "../response.js";
import { optionalString, requireObject, requireString } from "../../validation.js";

export async function routeAdminNotifications(context: HttpContext): Promise<boolean> {
  const { request, response, url, deliveries, options } = context;

  if (request.method === "GET" && url.pathname === "/api/v1/admin/notification-channels") {
    const channels = await deliveries.listChannels();
    writeJson(response, 200, { status: "success", data: channels.map(serializeNotificationChannel) }, options.corsOrigin);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/admin/notification-channels") {
    const body = requireObject(await readJson(request));
    const type = optionalString(body, "type") || "telegram";
    if (type !== "telegram") throw invalidPayload("type must be telegram");
    const channel = await deliveries.createChannel({
      name: requireString(body, "name"),
      botToken: requireString(body, "bot_token"),
      proxyUrl: body.proxy_url === undefined ? undefined : optionalString(body, "proxy_url"),
      proxyEnabled: optionalBoolean(body, "proxy_enabled", false),
      enabled: optionalBoolean(body, "enabled", true)
    });
    writeJson(response, 201, { status: "success", data: serializeNotificationChannel(channel) }, options.corsOrigin);
    return true;
  }

  const notificationChannelVerifyMatch = url.pathname.match(/^\/api\/v1\/admin\/notification-channels\/([^/:]+):verify$/);
  if (request.method === "POST" && notificationChannelVerifyMatch) {
    const channel = await deliveries.verifyChannel(decodeURIComponent(notificationChannelVerifyMatch[1]));
    writeJson(response, 200, { status: "success", data: serializeNotificationChannel(channel) }, options.corsOrigin);
    return true;
  }

  const notificationChannelChatsMatch = url.pathname.match(/^\/api\/v1\/admin\/notification-channels\/([^/]+)\/chats$/);
  if (request.method === "GET" && notificationChannelChatsMatch) {
    const chats = await deliveries.discoverChats(decodeURIComponent(notificationChannelChatsMatch[1]));
    writeJson(response, 200, { status: "success", data: chats.map(serializeTelegramChat) }, options.corsOrigin);
    return true;
  }

  const notificationChatTestMatch = url.pathname.match(/^\/api\/v1\/admin\/notification-channels\/([^/]+)\/chats\/([^/:]+):test$/);
  if (request.method === "POST" && notificationChatTestMatch) {
    await deliveries.sendTestChat(decodeURIComponent(notificationChatTestMatch[1]), decodeURIComponent(notificationChatTestMatch[2]));
    writeJson(response, 200, { status: "success", data: { sent: true } }, options.corsOrigin);
    return true;
  }

  const notificationChannelTargetsMatch = url.pathname.match(/^\/api\/v1\/admin\/notification-channels\/([^/]+)\/targets$/);
  if (request.method === "GET" && notificationChannelTargetsMatch) {
    const targets = await deliveries.listTargets(decodeURIComponent(notificationChannelTargetsMatch[1]));
    writeJson(response, 200, { status: "success", data: targets.map(serializeNotificationTarget) }, options.corsOrigin);
    return true;
  }
  if (request.method === "POST" && notificationChannelTargetsMatch) {
    const body = requireObject(await readJson(request));
    const target = await deliveries.createTarget(decodeURIComponent(notificationChannelTargetsMatch[1]), {
      name: requireString(body, "name"),
      chatId: requireString(body, "chat_id"),
      enabled: optionalBoolean(body, "enabled", true)
    });
    writeJson(response, 201, { status: "success", data: serializeNotificationTarget(target) }, options.corsOrigin);
    return true;
  }

  const notificationTargetTestMatch = url.pathname.match(/^\/api\/v1\/admin\/notification-channels\/([^/]+)\/targets\/([^/:]+):test$/);
  if (request.method === "POST" && notificationTargetTestMatch) {
    await deliveries.sendTest(decodeURIComponent(notificationTargetTestMatch[1]), decodeURIComponent(notificationTargetTestMatch[2]));
    writeJson(response, 200, { status: "success", data: { sent: true } }, options.corsOrigin);
    return true;
  }

  const notificationTargetMatch = url.pathname.match(/^\/api\/v1\/admin\/notification-channels\/([^/]+)\/targets\/([^/]+)$/);
  if (request.method === "PUT" && notificationTargetMatch) {
    const body = requireObject(await readJson(request));
    const target = await deliveries.updateTarget(decodeURIComponent(notificationTargetMatch[1]), decodeURIComponent(notificationTargetMatch[2]), {
      name: body.name === undefined ? undefined : requireString(body, "name"),
      chatId: body.chat_id === undefined ? undefined : requireString(body, "chat_id"),
      enabled: body.enabled === undefined ? undefined : optionalBoolean(body, "enabled")
    });
    writeJson(response, 200, { status: "success", data: serializeNotificationTarget(target) }, options.corsOrigin);
    return true;
  }
  if (request.method === "DELETE" && notificationTargetMatch) {
    const target = await deliveries.removeTarget(decodeURIComponent(notificationTargetMatch[1]), decodeURIComponent(notificationTargetMatch[2]));
    writeJson(response, 200, { status: "success", data: serializeNotificationTarget(target) }, options.corsOrigin);
    return true;
  }

  const notificationChannelMatch = url.pathname.match(/^\/api\/v1\/admin\/notification-channels\/([^/]+)$/);
  if (request.method === "PUT" && notificationChannelMatch) {
    const body = requireObject(await readJson(request));
    const channel = await deliveries.updateChannel(decodeURIComponent(notificationChannelMatch[1]), {
      name: body.name === undefined ? undefined : requireString(body, "name"),
      botToken: body.bot_token === undefined ? undefined : optionalString(body, "bot_token") || undefined,
      proxyUrl: body.proxy_url === undefined ? undefined : optionalString(body, "proxy_url"),
      proxyEnabled: body.proxy_enabled === undefined ? undefined : optionalBoolean(body, "proxy_enabled"),
      enabled: body.enabled === undefined ? undefined : optionalBoolean(body, "enabled")
    });
    writeJson(response, 200, { status: "success", data: serializeNotificationChannel(channel) }, options.corsOrigin);
    return true;
  }
  if (request.method === "DELETE" && notificationChannelMatch) {
    const channel = await deliveries.removeChannel(decodeURIComponent(notificationChannelMatch[1]));
    writeJson(response, 200, { status: "success", data: serializeNotificationChannel(channel) }, options.corsOrigin);
    return true;
  }

  return false;
}

function serializeNotificationChannel(channel: { id: string; type: string; name: string; botTokenConfigured: boolean; botTokenHint: string; proxyConfigured: boolean; proxyUrlHint?: string; proxyEnabled: boolean; botUsername?: string; botDisplayName?: string; enabled: boolean; lastVerifiedAt?: string; lastError?: string; createdAt: string; updatedAt: string }) {
  return { id: channel.id, type: channel.type, name: channel.name, bot_token_configured: channel.botTokenConfigured, bot_token_hint: channel.botTokenHint, proxy_configured: channel.proxyConfigured, proxy_url_hint: channel.proxyUrlHint, proxy_enabled: channel.proxyEnabled, bot_username: channel.botUsername, bot_display_name: channel.botDisplayName, enabled: channel.enabled, last_verified_at: channel.lastVerifiedAt, last_error: channel.lastError, created_at: channel.createdAt, updated_at: channel.updatedAt };
}

function serializeNotificationTarget(target: NotificationTarget) {
  return { id: target.id, channel_id: target.channelId, name: target.name, chat_id: target.chatId, enabled: target.enabled, created_at: target.createdAt, updated_at: target.updatedAt };
}

function serializeTelegramChat(chat: { id: string; type: string; title?: string; username?: string; firstName?: string; lastName?: string; alreadyConfigured: boolean }) {
  return { id: chat.id, type: chat.type, title: chat.title, username: chat.username, first_name: chat.firstName, last_name: chat.lastName, already_configured: chat.alreadyConfigured };
}
