import { enqueue, getQueueDepth, listPending, markUploaded } from "./queue.js";

const DEFAULT_API_ORIGIN = "http://localhost:3000";
const DEFAULT_MIN_DELAY_SECONDS = 5;
const DEFAULT_MAX_DELAY_SECONDS = 10;
const MINIMUM_DELAY_SECONDS = 5;
const ALARM_FALLBACK_DELAY_MS = 30_000;
const CAPTURE_STATE_KEY = "captureState";
const CAPTURE_LOCK_KEY = "captureLock";
const ACTIVITY_LOG_KEY = "activityLog";
const ACTIVITY_LOG_LIMIT = 60;
const HEARTBEAT_ALARM = "heartbeat";
const RECOVERY_ALARM = "resume-capture";
const NEXT_PROJECT_ALARM = "capture-next";

initializeRuntime().catch((error) => console.warn("Unable to initialize extension runtime", error));

chrome.runtime.onInstalled.addListener(async (details) => {
  await clearLegacyCaptureState(details.previousVersion);
  await initializeExtension();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureCoreAlarms();
  await configureSidePanel();
  await withCaptureLock(processCaptureState);
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === HEARTBEAT_ALARM) {
    const heartbeat = await sendHeartbeat();
    if (heartbeat.ok && !heartbeat.cancelled) await pollTasks();
  }
  if (alarm.name === RECOVERY_ALARM || alarm.name === NEXT_PROJECT_ALARM) {
    await withCaptureLock(async () => {
      const captureState = await getCaptureState();
      if (alarm.name === RECOVERY_ALARM && captureState?.phase === "read_trending" && captureState.trendingTabId) {
        await probeTrendingTab(captureState.trendingTabId);
      }
      await processCaptureState();
    });
  }
  await flushQueue();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  const captureState = await getCaptureState();
  if (!captureState) return;
  if (captureState.trendingTabId === tabId && captureState.phase === "read_trending") {
    const nextState = { ...captureState, trendingPageComplete: true };
    await setCaptureState(nextState);
    if (nextState.trendingContentReady) await withCaptureLock(processCaptureState);
    return;
  }
  if (captureState.phase !== "reading" || captureState.readTabId !== tabId) return;
  const nextState = { ...captureState, pageComplete: true };
  await setCaptureState(nextState);
  if (nextState.contentReady) await withCaptureLock(() => handleReadTab(tabId));
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const captureState = await getCaptureState();
  if (!captureState) return;
  if (captureState.readTabId === tabId) {
    await withCaptureLock(() => handleUnexpectedTabClose(tabId));
    return;
  }
  if (captureState.trendingTabId === tabId && !["completed", "stopped", "error"].includes(captureState.phase)) {
    await withCaptureLock(() => handleUnexpectedTrendingClose(tabId));
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === "GET_STATUS") {
      await resumeCaptureWhenDue();
      sendResponse(await getStatus());
      return;
    }
    if (message?.type === "CHECK_CONNECTION") {
      sendResponse(await sendHeartbeat());
      return;
    }
    if (message?.type === "REGISTER_DEVICE") {
      sendResponse(await registerAuthorizedDevice(message.payload));
      return;
    }
    if (message?.type === "START_CAPTURE") {
      const lockResult = await withCaptureLock(startCapture);
      sendResponse(lockResult.ok ? { ok: true } : { ok: false, code: lockResult.busy ? "capture_busy" : lockResult.error });
      return;
    }
    if (message?.type === "STOP_CAPTURE") {
      await stopCapture();
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === "RESUME_CAPTURE") {
      const lockResult = await withCaptureLock(resumeCapture);
      sendResponse(lockResult.ok ? { ok: true } : { ok: false, code: lockResult.busy ? "capture_busy" : lockResult.error });
      return;
    }
    if (message?.type === "UPDATE_SETTINGS") {
      sendResponse(await updateSettings(message.payload));
      return;
    }
    if (message?.type === "OPEN_TRENDING") {
      const tab = await ensureTrendingTab();
      await chrome.tabs.update(tab.id, { active: true });
      sendResponse({ ok: true, tabId: tab.id });
      return;
    }
    if (message?.type === "CONTENT_READY" && sender.tab?.id) {
      await recordActivity("content_ready", "页面内容脚本已就绪", { url: message.url ?? sender.tab.url ?? null });
      const captureState = await getCaptureState();
      if (captureState?.trendingTabId === sender.tab.id && captureState.phase === "read_trending") {
        const nextState = { ...captureState, trendingContentReady: true };
        await setCaptureState(nextState);
        if (nextState.trendingPageComplete) await withCaptureLock(processCaptureState);
      } else if (captureState?.phase === "reading" && captureState.readTabId === sender.tab.id) {
        const nextState = { ...captureState, contentReady: true };
        await setCaptureState(nextState);
        if (nextState.pageComplete) await withCaptureLock(() => handleReadTab(sender.tab.id));
      }
      sendResponse({ ok: true });
      return;
    }
    sendResponse({ ok: false, code: "unknown_message" });
  })().catch((error) => {
    console.error("Extension message failed", error);
    sendResponse({ ok: false, code: error.message ?? "unknown_error" });
  });
  return true;
});

async function initializeExtension() {
  const current = await chrome.storage.local.get([
    "apiOrigin",
    "connectionState",
    "queueDepth",
    "minDelaySeconds",
    "maxDelaySeconds"
  ]);
  const usesLegacyDelayDefaults = current.minDelaySeconds === 30 && current.maxDelaySeconds === 60;
  await chrome.storage.local.set({
    apiOrigin: current.apiOrigin ?? DEFAULT_API_ORIGIN,
    connectionState: current.connectionState ?? "未连接",
    queueDepth: current.queueDepth ?? 0,
    minDelaySeconds: usesLegacyDelayDefaults ? DEFAULT_MIN_DELAY_SECONDS : current.minDelaySeconds ?? DEFAULT_MIN_DELAY_SECONDS,
    maxDelaySeconds: usesLegacyDelayDefaults ? DEFAULT_MAX_DELAY_SECONDS : current.maxDelaySeconds ?? DEFAULT_MAX_DELAY_SECONDS
  });
  await ensureCoreAlarms();
  await configureSidePanel();
}

async function initializeRuntime() {
  await ensureCoreAlarms();
  await configureSidePanel();
}

async function clearLegacyCaptureState(previousVersion) {
  if (!previousVersion || previousVersion === chrome.runtime.getManifest().version) return;
  const captureState = await getCaptureState();
  await chrome.storage.session.remove([CAPTURE_STATE_KEY, CAPTURE_LOCK_KEY]);
  await chrome.alarms.clear(NEXT_PROJECT_ALARM);
  if (captureState?.readTabId) await closeTabSafely(captureState.readTabId);
}

async function ensureCoreAlarms() {
  await chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 0.5 });
  await chrome.alarms.create(RECOVERY_ALARM, { periodInMinutes: 0.5 });
}

async function configureSidePanel() {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

async function ensureTrendingTab() {
  const [existingTab] = await chrome.tabs.query({ url: "https://github.com/trending*" });
  if (existingTab?.id) {
    await recordActivity("trending_reused", "复用 Trending 标签页", { url: existingTab.url ?? "https://github.com/trending" });
    return existingTab;
  }
  const tab = await chrome.tabs.create({ url: "https://github.com/trending", active: true });
  await recordActivity("trending_opened", "打开 Trending 标签页", { url: "https://github.com/trending" });
  return tab;
}

async function probeTrendingTab(tabId) {
  await recordActivity("trending_probe", "探测 Trending 页面内容脚本", { tabId });
  try {
    await chrome.tabs.sendMessage(tabId, { type: "READ_TRENDING" });
    const captureState = await getCaptureState();
    if (captureState?.trendingTabId === tabId && captureState.phase === "read_trending") {
      await setCaptureState({ ...captureState, trendingContentReady: true });
      await processCaptureState();
    }
  } catch {
    try {
      await chrome.tabs.reload(tabId);
      await recordActivity("trending_reloaded", "内容脚本不可用，已重载 Trending 页面", { tabId });
    } catch (error) {
      const captureState = await getCaptureState();
      if (captureState?.trendingTabId === tabId) {
        await setCaptureState({
          ...captureState,
          phase: "error",
          resumePhase: "read_trending",
          lastError: "trending_content_script_unavailable"
        });
      }
      await recordActivity("trending_probe_failed", "Trending 页面重载失败", { tabId, error: error.message ?? "unknown_error" });
      throw new Error("trending_content_script_unavailable", { cause: error });
    }
  }
}

async function closeTabSafely(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!Number.isInteger(tab.windowId)) return false;
    const tabs = await chrome.tabs.query({ windowId: tab.windowId });
    if (tabs.length <= 1) return false;
    await chrome.tabs.remove(tabId);
    return true;
  } catch (error) {
    console.warn("Unable to close capture tab safely", error);
    return false;
  }
}

async function startCapture(task = null) {
  const existingState = await getCaptureState();
  if (existingState && !["completed", "stopped", "error"].includes(existingState.phase)) {
    throw new Error("已有采集任务正在进行");
  }

  const tab = await ensureTrendingTab();

  await chrome.alarms.clear(NEXT_PROJECT_ALARM);
  await setCaptureState({
    phase: "read_trending",
    trendingTabId: tab.id,
    readTabId: null,
    projectIndex: 0,
    projects: [],
    runId: null,
    taskId: task?.taskId ?? null,
    businessDate: task?.businessDate ?? new Date().toISOString().slice(0, 10),
    nextRunAt: null,
    pageComplete: false,
    contentReady: false,
    trendingPageComplete: tab.status === "complete",
    trendingContentReady: false,
    startedAt: new Date().toISOString(),
    completedAt: null,
    lastError: null
  });
  await probeTrendingTab(tab.id);
  await recordActivity("capture_started", task ? "已开始执行管理端任务" : "已开始手动采集", { taskId: task?.taskId ?? null });
  await updateCaptureStatus("正在读取 Trending", null);
  await processCaptureState();
}

async function stopCapture() {
  const captureState = await getCaptureState();
  if (!captureState || ["completed", "stopped"].includes(captureState.phase)) return;

  const readTabId = captureState.readTabId;
  const resumePhase = captureState.phase === "read_trending" ? "read_trending" : "read_readme";
  await setCaptureState({
    ...captureState,
    phase: "stopped",
    resumePhase,
    readTabId: null,
    nextRunAt: null,
    pageComplete: false,
    contentReady: false
  });
  await chrome.alarms.clear(NEXT_PROJECT_ALARM);
  if (readTabId) await closeTabSafely(readTabId);
  if (captureState.taskId) await updateRemoteTask(captureState.taskId, "paused").catch(() => undefined);
  await recordActivity("capture_paused", "采集已暂停", { taskId: captureState.taskId ?? null });
  await updateCaptureStatus("已暂停", captureState.lastError ?? null);
}

async function stopCaptureForCancellation() {
  const captureState = await getCaptureState();
  if (!captureState || !captureState.taskId) return;
  const taskId = captureState.taskId;
  const readTabId = captureState.readTabId;
  await setCaptureState({
    ...captureState,
    phase: "stopped",
    resumePhase: "read_readme",
    taskId: null,
    readTabId: null,
    nextRunAt: null,
    pageComplete: false,
    contentReady: false,
    lastError: "task_cancelled"
  });
  await chrome.alarms.clear(NEXT_PROJECT_ALARM);
  if (readTabId) await closeTabSafely(readTabId);
  await recordActivity("task_cancelled", "管理端已取消采集任务", { taskId });
  await updateCaptureStatus("任务已取消", "task_cancelled");
}

async function stopCaptureForAuthorizationLoss(reason) {
  const captureState = await getCaptureState();
  if (!captureState || ["completed", "stopped", "error"].includes(captureState.phase)) return;
  const readTabId = captureState.readTabId;
  await setCaptureState({
    ...captureState,
    phase: "stopped",
    resumePhase: captureState.phase === "read_trending" ? "read_trending" : "read_readme",
    taskId: null,
    readTabId: null,
    nextRunAt: null,
    pageComplete: false,
    contentReady: false,
    lastError: reason
  });
  await chrome.alarms.clear(NEXT_PROJECT_ALARM);
  if (readTabId) await closeTabSafely(readTabId);
  await recordActivity("authorization_lost", "设备授权已失效，采集已停止", { error: reason });
  await updateCaptureStatus("等待重新授权", reason);
}

async function resumeCapture() {
  const captureState = await getCaptureState();
  if (!captureState || !["stopped", "error"].includes(captureState.phase)) {
    throw new Error("没有可继续的采集任务");
  }

  const phase = captureState.resumePhase === "read_trending" || !captureState.projects.length
    ? "read_trending"
    : "read_readme";
  const staleReadTabId = captureState.readTabId;
  await setCaptureState({
    ...captureState,
    phase,
    readTabId: null,
    nextRunAt: null,
    pageComplete: false,
    contentReady: false,
    lastError: null
  });
  if (phase === "read_trending") {
    const trendingTab = await ensureTrendingTab();
    const resumedState = await getCaptureState();
    await setCaptureState({
      ...resumedState,
      trendingTabId: trendingTab.id,
      trendingPageComplete: trendingTab.status === "complete",
      trendingContentReady: false
    });
    await probeTrendingTab(trendingTab.id);
  }
  if (staleReadTabId) await closeTabSafely(staleReadTabId);
  if (captureState.taskId) await updateRemoteTask(captureState.taskId, "running", captureState.runId).catch(() => undefined);
  await updateCaptureStatus("采集中", null);
  await processCaptureState();
}

async function processCaptureState() {
  let captureState = await getCaptureState();
  if (!captureState || ["completed", "stopped", "error"].includes(captureState.phase)) return;

  if (captureState.phase === "read_trending") {
    if (!captureState.trendingPageComplete || !captureState.trendingContentReady) {
      await recordActivity("trending_waiting", "等待 Trending 页面就绪", {
        tabId: captureState.trendingTabId,
        pageComplete: Boolean(captureState.trendingPageComplete),
        contentReady: Boolean(captureState.trendingContentReady)
      });
      return;
    }
    const result = await chrome.tabs.sendMessage(captureState.trendingTabId, { type: "READ_TRENDING" });
    const projects = result.projects ?? [];
    if (!projects.length) throw new Error("未在当前页面识别到 Trending 项目");
    await recordActivity("trending_read", "已识别 Trending 项目", { url: result.url, count: projects.length });

    const run = await apiRequest("/api/v1/collection-runs", {
      method: "POST",
      headers: { "idempotency-key": captureState.taskId ? `task-${captureState.taskId}` : `trending-${captureState.businessDate}` },
      body: JSON.stringify({
        business_date: captureState.businessDate,
        source_url: result.url,
        filters: {}
      })
    });
    captureState = {
      ...captureState,
      phase: "read_readme",
      projects,
      runId: run.data.id,
      lastError: null
    };
    await setCaptureState(captureState);
    if (captureState.taskId) await updateRemoteTask(captureState.taskId, "running", captureState.runId);
    await updateCaptureStatus("采集中", null);
  }

  if (captureState.phase === "waiting") {
    const remainingMs = Math.max(0, Number(captureState.nextRunAt) - Date.now());
    if (remainingMs > 0) {
      await scheduleNextProject(captureState.nextRunAt);
      return;
    }
    captureState = { ...captureState, phase: "read_readme", nextRunAt: null };
    await setCaptureState(captureState);
  }

  if (captureState.phase !== "read_readme") return;
  if (captureState.projectIndex >= captureState.projects.length) {
    await completeCapture(captureState);
    return;
  }
  if (captureState.readTabId) return;
  await openProjectTab(captureState);
}

async function openProjectTab(captureState) {
  const project = captureState.projects[captureState.projectIndex];
  await recordActivity("project_opening", "准备打开项目页面", { url: project.url, rank: project.rank });
  const readTab = await chrome.tabs.create({ url: "about:blank", active: false });
  const readingState = {
    ...captureState,
    phase: "reading",
    readTabId: readTab.id,
    pageComplete: false,
    contentReady: false,
    nextRunAt: null,
    currentProjectStartedAt: new Date().toISOString(),
    lastError: null
  };
  await setCaptureState(readingState);

  try {
    await chrome.tabs.update(readTab.id, { url: project.url });
    await recordActivity("project_opened", "已打开项目页面", { url: project.url, rank: project.rank });
  } catch (error) {
    await handleProjectResult(readingState, {
      html: "",
      text: "",
      errorCode: error.message || "read_tab_open_failed"
    });
  }
}

async function handleReadTab(tabId) {
  const captureState = await getCaptureState();
  if (!captureState || captureState.phase !== "reading" || captureState.readTabId !== tabId) return;

  let result;
  try {
    result = await chrome.tabs.sendMessage(tabId, { type: "READ_README" });
  } catch (error) {
    result = { html: "", text: "", errorCode: error.message || "readme_unavailable" };
  }
  await recordActivity(result.errorCode ? "project_read_failed" : "project_read", result.errorCode ? "项目页面读取失败" : "已读取项目 README", {
    url: captureState.projects[captureState.projectIndex]?.url,
    error: result.errorCode ?? null,
    selector: result.selector ?? null,
    pageTitle: result.pageTitle ?? null
  });
  await handleProjectResult(captureState, result);
}

async function handleUnexpectedTabClose(tabId) {
  const captureState = await getCaptureState();
  if (!captureState || captureState.phase !== "reading" || captureState.readTabId !== tabId) return;
  await handleProjectResult(captureState, { html: "", text: "", errorCode: "read_tab_closed" }, false);
}

async function handleUnexpectedTrendingClose(tabId) {
  const captureState = await getCaptureState();
  if (!captureState || captureState.trendingTabId !== tabId) return;
  await setCaptureState({
    ...captureState,
    phase: "error",
    resumePhase: "read_trending",
    trendingTabId: null,
    trendingPageComplete: false,
    trendingContentReady: false,
    lastError: "trending_tab_closed"
  });
  await chrome.alarms.clear(NEXT_PROJECT_ALARM);
  if (captureState.taskId) await updateRemoteTask(captureState.taskId, "failed", undefined, "trending_tab_closed").catch(() => undefined);
  await updateCaptureStatus("采集失败", "trending_tab_closed");
}

async function handleProjectResult(captureState, result, closeTab = true) {
  const project = captureState.projects[captureState.projectIndex];
  const errorCode = result.errorCode || (!result.text && !result.html ? "readme_empty" : null);
  await enqueue({
    id: `${captureState.runId}:${project.url}`,
    runId: captureState.runId,
    project_url: project.url,
    rank: project.rank,
    name: project.name,
    readme_html: result.html ?? "",
    readme_text: result.text ?? "",
    read_at: new Date().toISOString(),
    status: errorCode ? "failed" : "success",
    error_code: errorCode ?? undefined
  });

  const tabId = captureState.readTabId;
  const nextIndex = captureState.projectIndex + 1;
  if (nextIndex >= captureState.projects.length) {
    await completeCapture({ ...captureState, projectIndex: nextIndex, readTabId: null, lastError: errorCode });
  } else {
    const delaySeconds = await getRandomDelaySeconds();
    const nextRunAt = Date.now() + delaySeconds * 1000;
    await setCaptureState({
      ...captureState,
      phase: "waiting",
      projectIndex: nextIndex,
      readTabId: null,
      pageComplete: false,
      contentReady: false,
      nextRunAt,
      lastError: errorCode
    });
    await scheduleNextProject(nextRunAt);
    await updateCaptureStatus("等待下一个项目", errorCode);
  }

  // 状态必须先推进并清空 readTabId，再主动关闭标签页，避免 onRemoved 重复调度旧项目。
  if (closeTab && tabId) await closeTabSafely(tabId);
  await updateQueueDepth();
  await flushQueue();
}

async function completeCapture(captureState) {
  await chrome.alarms.clear(NEXT_PROJECT_ALARM);
  await setCaptureState({
    ...captureState,
    phase: "completed",
    projectIndex: captureState.projects.length,
    readTabId: null,
    nextRunAt: null,
    pageComplete: false,
    contentReady: false,
    completedAt: new Date().toISOString()
  });
  if (captureState.taskId) {
    await updateRemoteTask(captureState.taskId, "completed", captureState.runId).catch((error) => {
      console.warn("Unable to update completed task", error);
    });
  }
  await recordActivity("capture_completed", "采集任务已完成", { taskId: captureState.taskId ?? null, runId: captureState.runId ?? null });
  await updateCaptureStatus("采集完成", captureState.lastError ?? null);
}

async function scheduleNextProject(nextRunAt) {
  const fallbackAt = Math.max(Number(nextRunAt), Date.now() + ALARM_FALLBACK_DELAY_MS);
  await chrome.alarms.create(NEXT_PROJECT_ALARM, { when: fallbackAt });
}

async function resumeCaptureWhenDue() {
  const captureState = await getCaptureState();
  if (captureState?.phase !== "waiting" || Number(captureState.nextRunAt) > Date.now()) return;
    await processCaptureState();
}

async function getRandomDelaySeconds() {
  const settings = await chrome.storage.local.get(["minDelaySeconds", "maxDelaySeconds"]);
  const min = Number(settings.minDelaySeconds ?? DEFAULT_MIN_DELAY_SECONDS);
  const max = Number(settings.maxDelaySeconds ?? DEFAULT_MAX_DELAY_SECONDS);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function updateSettings(payload) {
  if (payload.apiOrigin !== undefined) {
    const apiOrigin = String(payload.apiOrigin).trim().replace(/\/$/, "");
    if (!/^https?:\/\//.test(apiOrigin)) throw new Error("服务端地址必须以 http:// 或 https:// 开头");
    const current = await chrome.storage.local.get("apiOrigin");
    if (current.apiOrigin && current.apiOrigin !== apiOrigin) await clearDeviceCredentials("服务端地址已变更，请重新输入授权码");
    await chrome.storage.local.set({ apiOrigin });
  }
  if (payload.minDelaySeconds === undefined && payload.maxDelaySeconds === undefined) return { ok: true };
  const minDelaySeconds = Number(payload.minDelaySeconds);
  const maxDelaySeconds = Number(payload.maxDelaySeconds);
  if (!Number.isInteger(minDelaySeconds) || !Number.isInteger(maxDelaySeconds)) {
    throw new Error("请求间隔必须是整数秒");
  }
  if (minDelaySeconds < MINIMUM_DELAY_SECONDS || maxDelaySeconds > 600 || minDelaySeconds > maxDelaySeconds) {
    throw new Error("请求间隔需在 5–600 秒之间，且最小值不能大于最大值");
  }
  await chrome.storage.local.set({ minDelaySeconds, maxDelaySeconds });
  return { ok: true };
}

async function flushQueue() {
  const pending = await listPending(20);
  if (!pending.length) return;
  const groups = new Map();
  pending.forEach((item) => {
    const group = groups.get(item.runId) ?? [];
    group.push(item);
    groups.set(item.runId, group);
  });
  for (const [runId, items] of groups) {
    try {
      await apiRequest(`/api/v1/collection-runs/${encodeURIComponent(runId)}/items:batch`, {
        method: "POST",
        body: JSON.stringify({
          items: items.map(({ id, runId: _runId, uploadStatus: _uploadStatus, attempts: _attempts, ...item }) => item)
        })
      });
      await markUploaded(items.map((item) => item.id));
      await recordActivity("items_uploaded", "已上传采集数据", { runId, count: items.length });
    } catch (error) {
      await updateCaptureStatus("上传重试中", error.message);
    }
  }
  await updateQueueDepth();
}

async function pollTasks() {
  const captureState = await getCaptureState();
  if (captureState && !["completed", "stopped", "error"].includes(captureState.phase)) return;
  try {
    const response = await apiRequest("/api/v1/devices/tasks:claim", { method: "POST", body: "{}" });
    const task = response.data.task;
    if (!task) return;
    await recordActivity("task_received", "已领取管理端采集任务", { taskId: task.id });
    await reportRuntimeLog("info", "task_received", "A collection task was received", task.id);
    const result = await withCaptureLock(() => startCapture({ taskId: task.id, businessDate: task.business_date }));
    if (!result.ok && !result.busy) {
      await updateRemoteTask(task.id, "failed", undefined, result.error || "capture_start_failed").catch(() => undefined);
    }
  } catch (error) {
    await reportRuntimeLog("error", "task_poll_failed", error.message || "Unable to poll tasks");
  }
}

async function updateRemoteTask(taskId, status, runId, errorCode) {
  return apiRequest(`/api/v1/devices/tasks/${encodeURIComponent(taskId)}:status`, {
    method: "POST",
    body: JSON.stringify({ status, run_id: runId, error_code: errorCode })
  });
}

async function reportRuntimeLog(level, event, message, taskId = null, metadata = undefined) {
  try {
    await apiRequest("/api/v1/devices/logs", {
      method: "POST",
      body: JSON.stringify({ level, event, message, task_id: taskId, metadata })
    });
  } catch (error) {
    console.warn("Unable to report runtime log", error);
  }
}

async function sendHeartbeat() {
  try {
    const captureState = await getCaptureState();
    const response = await apiRequest("/api/v1/devices/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        extension_version: chrome.runtime.getManifest().version,
        queue_depth: await getQueueDepth(),
        task_id: captureState?.taskId ?? undefined
      })
    });
    const cancelled = Boolean(response.data?.task_cancelled);
    if (cancelled) await stopCaptureForCancellation();
    await chrome.storage.local.set({ lastHeartbeatAt: new Date().toISOString() });
    await recordActivity("heartbeat", "已发送心跳并检查任务", { taskId: captureState?.taskId ?? null });
    await updateConnectionStatus("在线", null);
    return { ok: true, cancelled };
  } catch (error) {
    await recordActivity("heartbeat_failed", "心跳发送失败", { error: error.message ?? "connection_failed" });
    const unauthorized = ["device_revoked", "invalid_token", "authorization_code_required"].includes(error.message);
    await updateConnectionStatus(unauthorized ? "未授权" : "离线", error.message);
    return { ok: false, code: error.message || "connection_failed" };
  }
}

async function apiRequest(path, init = {}, allowRefresh = true) {
  const settings = await chrome.storage.local.get(["apiOrigin", "deviceId", "access_token", "refresh_token"]);
  if (!settings.apiOrigin) throw new Error("未配置服务端地址");
  const deviceId = settings.deviceId ?? await ensureDeviceRegistration(settings.apiOrigin);
  const headers = { "content-type": "application/json", ...(init.headers ?? {}) };
  headers["x-device-id"] = deviceId;
  if (settings.access_token) headers.authorization = `Bearer ${settings.access_token}`;
  const response = await fetch(`${settings.apiOrigin}${path}`, { ...init, headers });
  if (response.status === 401 && allowRefresh && settings.refresh_token) {
    const refresh = await fetch(`${settings.apiOrigin}/api/v1/devices/token:refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: settings.refresh_token })
    });
    if (refresh.ok) {
      const body = await refresh.json();
      await chrome.storage.local.set(body.data);
      return apiRequest(path, init, false);
    }
    await clearDeviceCredentials("设备令牌已失效，请重新授权");
  }
  const body = await response.json();
  if (!response.ok) {
    if (body.code === "device_revoked" || body.code === "invalid_token") await clearDeviceCredentials(body.code === "device_revoked" ? "设备授权已被删除" : "设备令牌已失效，请重新授权");
    throw new Error(body.code || body.message || "服务端请求失败");
  }
  return body;
}

async function registerAuthorizedDevice(payload) {
  const apiOrigin = String(payload?.apiOrigin ?? "").trim().replace(/\/$/, "");
  const registrationCode = String(payload?.registrationCode ?? "").trim();
  if (!/^https?:\/\//.test(apiOrigin)) return { ok: false, code: "invalid_api_origin" };
  if (!registrationCode) return { ok: false, code: "authorization_code_required" };
  try {
    const captureState = await getCaptureState();
    if (captureState && !["completed", "stopped", "error"].includes(captureState.phase)) return { ok: false, code: "capture_busy" };
    await chrome.storage.local.set({ apiOrigin });
    await clearDeviceCredentials(null);
    await ensureDeviceRegistration(apiOrigin, registrationCode);
    const heartbeat = await sendHeartbeat();
    if (heartbeat.ok && !heartbeat.cancelled) await pollTasks();
    return heartbeat.ok ? { ok: true } : heartbeat;
  } catch (error) {
    await updateConnectionStatus("未授权", error.message ?? "authorization_failed");
    return { ok: false, code: error.message ?? "authorization_failed" };
  }
}

async function ensureDeviceRegistration(apiOrigin, registrationCode = "") {
  const response = await fetch(`${apiOrigin}/api/v1/devices/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...(registrationCode ? { registration_code: registrationCode } : {}),
      name: `Chrome ${navigator.platform}`,
      extension_version: chrome.runtime.getManifest().version
    })
  });
  const body = await response.json();
  if (!response.ok) throw new Error(!registrationCode && body.code === "invalid_payload" ? "authorization_code_required" : body.code || body.message || "无法连接服务端");
  const device = body.data.device;
  await chrome.storage.local.set({ ...body.data, deviceId: device.id, device, connectionState: "已注册", connectionError: null });
  return device.id;
}

async function clearDeviceCredentials(connectionError) {
  await chrome.storage.local.remove(["deviceId", "device", "access_token", "refresh_token", "access_token_expires_at", "refresh_token_expires_at"]);
  if (connectionError !== null) {
    await chrome.storage.local.set({ connectionState: "未授权", connectionError });
    await stopCaptureForAuthorizationLoss(connectionError);
  }
}

async function updateQueueDepth() {
  await chrome.storage.local.set({ queueDepth: await getQueueDepth() });
}

async function updateConnectionStatus(connectionState, connectionError = null) {
  await chrome.storage.local.set({ connectionState, connectionError, queueDepth: await getQueueDepth() });
}

async function updateCaptureStatus(captureStatus, lastError = null) {
  await chrome.storage.local.set({ captureStatus, lastError, queueDepth: await getQueueDepth() });
}

async function getStatus() {
  const local = await chrome.storage.local.get([
    "apiOrigin",
    "connectionState",
    "connectionError",
    "captureStatus",
    "lastError",
    "lastHeartbeatAt",
    "minDelaySeconds",
    "maxDelaySeconds",
    "device"
  ]);
  const captureState = await getCaptureState();
  const activityResult = await chrome.storage.session.get(ACTIVITY_LOG_KEY);
  const currentProject = captureState?.projects?.[captureState.projectIndex] ?? null;
  return {
    ...local,
    queueDepth: await getQueueDepth(),
    captureState: captureState ? { ...captureState, currentProject } : null,
    activityLogs: Array.isArray(activityResult[ACTIVITY_LOG_KEY]) ? activityResult[ACTIVITY_LOG_KEY] : []
  };
}

async function recordActivity(event, message, metadata = {}) {
  try {
    const current = await chrome.storage.session.get(ACTIVITY_LOG_KEY);
    const entries = Array.isArray(current[ACTIVITY_LOG_KEY]) ? current[ACTIVITY_LOG_KEY] : [];
    entries.push({ id: crypto.randomUUID(), event, message, metadata, occurredAt: new Date().toISOString() });
    await chrome.storage.session.set({ [ACTIVITY_LOG_KEY]: entries.slice(-ACTIVITY_LOG_LIMIT) });
  } catch (error) {
    console.warn("Unable to record local activity", error);
  }
}

async function getCaptureState() {
  const result = await chrome.storage.session.get(CAPTURE_STATE_KEY);
  return result[CAPTURE_STATE_KEY] ?? null;
}

async function setCaptureState(captureState) {
  await chrome.storage.session.set({ [CAPTURE_STATE_KEY]: captureState });
}

async function withCaptureLock(operation) {
  return navigator.locks.request("automation-hub-capture", { ifAvailable: true }, async (lock) => {
    if (!lock) return { ok: false, busy: true };
    try {
      await operation();
      return { ok: true };
    } catch (error) {
      console.error("Capture failed", error);
      const captureState = await getCaptureState();
      if (captureState) await setCaptureState({ ...captureState, lastError: error.message ?? "unknown_error" });
      if (captureState?.taskId) await updateRemoteTask(captureState.taskId, "failed", captureState.runId, error.message ?? "unknown_error").catch(() => undefined);
      await recordActivity("capture_failed", "采集执行失败", { taskId: captureState?.taskId ?? null, error: error.message ?? "unknown_error" });
      await reportRuntimeLog("error", "capture_failed", error.message ?? "unknown_error", captureState?.taskId ?? null);
      await updateCaptureStatus("采集失败", error.message ?? "unknown_error");
      return { ok: false, error: error.message ?? "unknown_error" };
    }
  });
}
