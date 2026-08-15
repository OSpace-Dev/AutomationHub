const elements = {
  apiOrigin: document.querySelector("#api-origin"),
  authorizationCode: document.querySelector("#authorization-code"),
  authorizationForm: document.querySelector("#authorization-form"),
  activityLogList: document.querySelector("#activity-log-list"),
  capturePhase: document.querySelector("#capture-phase"),
  connectionChip: document.querySelector("#connection-chip"),
  connectionState: document.querySelector("#connection-state"),
  currentProjectName: document.querySelector("#current-project-name"),
  delayForm: document.querySelector("#delay-form"),
  delaySummary: document.querySelector("#delay-summary"),
  errorPanel: document.querySelector("#error-panel"),
  heartbeatAt: document.querySelector("#heartbeat-at"),
  lastError: document.querySelector("#last-error"),
  maxDelay: document.querySelector("#max-delay"),
  message: document.querySelector("#message"),
  minDelay: document.querySelector("#min-delay"),
  nextCountdown: document.querySelector("#next-countdown"),
  openTrending: document.querySelector("#open-trending"),
  progressBar: document.querySelector("#progress-bar"),
  progressCount: document.querySelector("#progress-count"),
  queueDepth: document.querySelector("#queue-depth"),
  refreshConnection: document.querySelector("#refresh-connection"),
  registerDevice: document.querySelector("#register-device"),
  startCapture: document.querySelector("#start-capture"),
  stopCapture: document.querySelector("#stop-capture")
};

const phaseLabels = {
  read_trending: "读取榜单",
  read_readme: "准备项目",
  reading: "读取 README",
  waiting: "请求间隔",
  stopped: "已暂停",
  completed: "已完成",
  error: "需要处理"
};

let currentStatus = null;
let statusTimer = null;
let countdownTimer = null;
let lastActivitySignature = "";

elements.openTrending.addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "OPEN_TRENDING" });
  showMessage(response.ok ? "已打开 GitHub Trending。" : response.code || "无法打开页面。", response.ok ? "success" : "error");
});

elements.refreshConnection.addEventListener("click", async () => {
  elements.refreshConnection.disabled = true;
  elements.refreshConnection.classList.add("is-loading");
  const response = await chrome.runtime.sendMessage({ type: "CHECK_CONNECTION" });
  showMessage(response.ok ? "服务连接正常，心跳已更新。" : readableError(response.code), response.ok ? "success" : "error");
  await refreshStatus();
  elements.refreshConnection.disabled = false;
  elements.refreshConnection.classList.remove("is-loading");
});

elements.startCapture.addEventListener("click", async () => {
  const phase = currentStatus?.captureState?.phase;
  const response = phase === "stopped" || phase === "error"
    ? await chrome.runtime.sendMessage({ type: "RESUME_CAPTURE" })
    : await startNewCapture();
  showMessage(response.ok ? "采集任务已开始，正在自动打开 Trending。" : readableError(response.code), response.ok ? "success" : "error");
  await refreshStatus();
});

elements.stopCapture.addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "STOP_CAPTURE" });
  showMessage(response.ok ? "采集已暂停，可稍后继续。" : readableError(response.code), response.ok ? "success" : "error");
  await refreshStatus();
});

elements.delayForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const response = await chrome.runtime.sendMessage({
    type: "UPDATE_SETTINGS",
    payload: {
      minDelaySeconds: Number(elements.minDelay.value),
      maxDelaySeconds: Number(elements.maxDelay.value)
    }
  });
  showMessage(response.ok ? "请求间隔已保存。" : readableError(response.code), response.ok ? "success" : "error");
  await refreshStatus();
});

elements.apiOrigin.addEventListener("change", async () => {
  const permissionGranted = await ensureApiPermission(elements.apiOrigin.value);
  if (!permissionGranted) {
    showMessage("未授予该服务地址的访问权限。", "error");
    return;
  }
  const response = await chrome.runtime.sendMessage({ type: "UPDATE_SETTINGS", payload: { apiOrigin: elements.apiOrigin.value } });
  showMessage(response.ok ? "服务端地址已保存。" : readableError(response.code), response.ok ? "success" : "error");
});

elements.authorizationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const apiOrigin = elements.apiOrigin.value.trim();
  if (!await ensureApiPermission(apiOrigin)) {
    showMessage("未授予该服务地址的访问权限。", "error");
    return;
  }
  elements.registerDevice.disabled = true;
  elements.registerDevice.classList.add("is-loading");
  const response = await chrome.runtime.sendMessage({ type: "REGISTER_DEVICE", payload: { apiOrigin, registrationCode: elements.authorizationCode.value } });
  showMessage(response.ok ? "设备授权成功，心跳已建立。" : readableError(response.code), response.ok ? "success" : "error");
  if (response.ok) elements.authorizationCode.value = "";
  await refreshStatus();
  elements.registerDevice.disabled = false;
  elements.registerDevice.classList.remove("is-loading");
});

async function startNewCapture() {
  return chrome.runtime.sendMessage({ type: "START_CAPTURE" });
}

async function refreshStatus() {
  try {
    currentStatus = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
    renderStatus(currentStatus);
  } catch (error) {
    showMessage(error.message || "无法读取扩展状态。", "error");
  }
}

function renderStatus(status) {
  const captureState = status.captureState;
  const connectionState = status.connectionState ?? "未连接";
  const connectionTone = connectionState === "在线"
    ? "online"
    : connectionState === "离线" || connectionState.includes("失败")
      ? "offline"
      : connectionState === "已注册"
        ? "registered"
        : "unknown";

  elements.connectionChip.dataset.state = connectionTone;
  elements.connectionChip.textContent = connectionState;
  elements.connectionState.textContent = connectionState;
  elements.heartbeatAt.textContent = formatTime(status.lastHeartbeatAt);
  elements.queueDepth.textContent = String(status.queueDepth ?? 0);

  const minDelay = Number(status.minDelaySeconds ?? 5);
  const maxDelay = Number(status.maxDelaySeconds ?? 10);
  if (document.activeElement !== elements.minDelay) elements.minDelay.value = String(minDelay);
  if (document.activeElement !== elements.maxDelay) elements.maxDelay.value = String(maxDelay);
  if (document.activeElement !== elements.apiOrigin) elements.apiOrigin.value = status.apiOrigin ?? "http://localhost:3000";
  elements.delaySummary.textContent = `${minDelay}–${maxDelay} 秒`;

  const total = captureState?.projects?.length ?? 0;
  const index = captureState?.projectIndex ?? 0;
  const completed = captureState?.phase === "completed" ? total : Math.min(index, total);
  const displayIndex = total && captureState && captureState.phase !== "completed" ? Math.min(index + 1, total) : completed;
  const progress = total ? Math.round((completed / total) * 100) : 0;
  elements.progressBar.style.width = `${progress}%`;
  elements.progressCount.textContent = `${displayIndex} / ${total}`;
  elements.capturePhase.textContent = phaseLabels[captureState?.phase] ?? "未开始";
  elements.currentProjectName.textContent = captureState?.currentProject?.name || (captureState?.phase === "completed" ? "本次采集已完成" : "暂无");

  const activePhases = ["read_trending", "read_readme", "reading", "waiting"];
  elements.stopCapture.disabled = !activePhases.includes(captureState?.phase);
  elements.startCapture.disabled = activePhases.includes(captureState?.phase);
  elements.startCapture.querySelector("span").textContent = captureState?.phase === "stopped" || captureState?.phase === "error" ? "继续采集" : "开始采集";

  const lastError = captureState?.lastError || status.lastError || status.connectionError;
  elements.errorPanel.hidden = !lastError;
  elements.lastError.textContent = lastError ? readableError(lastError) : "";
  renderActivityLog(status);
  renderCountdown();
}

function renderCountdown() {
  const captureState = currentStatus?.captureState;
  if (captureState?.phase === "waiting" && captureState.nextRunAt) {
    const remainingSeconds = Math.max(0, Math.ceil((captureState.nextRunAt - Date.now()) / 1000));
    elements.nextCountdown.textContent = remainingSeconds > 0 ? `${remainingSeconds} 秒后继续` : "即将继续";
    return;
  }
  const labels = {
    reading: "正在读取",
    read_trending: "正在分析榜单",
    read_readme: "正在准备",
    completed: "全部完成",
    stopped: "等待继续"
  };
  elements.nextCountdown.textContent = labels[captureState?.phase] ?? "等待开始";
}

function renderActivityLog(status) {
  const entries = Array.isArray(status.activityLogs) ? status.activityLogs.slice(-30).reverse() : [];
  const signature = entries.map((entry) => entry.id).join("|");
  if (signature === lastActivitySignature) return;
  lastActivitySignature = signature;
  elements.activityLogList.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement("li");
    empty.className = "activity-empty";
    empty.textContent = "等待插件活动...";
    elements.activityLogList.append(empty);
    return;
  }
  entries.forEach((entry) => {
    const item = document.createElement("li");
    item.className = "activity-entry";
    const meta = document.createElement("span");
    meta.className = "activity-meta";
    meta.textContent = `${formatTime(entry.occurredAt)} · ${entry.event}`;
    const message = document.createElement("strong");
    message.textContent = entry.message;
    item.append(meta, message);
    const details = [];
    if (entry.metadata?.count !== undefined) details.push(`${entry.metadata.count} 项`);
    if (entry.metadata?.runId) details.push(`批次 ${entry.metadata.runId}`);
    if (entry.metadata?.taskId) details.push(`任务 ${entry.metadata.taskId}`);
    if (entry.metadata?.error) details.push(`错误 ${entry.metadata.error}`);
    if (details.length) {
      const detail = document.createElement("span");
      detail.className = "activity-url";
      detail.textContent = details.join(" · ");
      item.append(detail);
    }
    if (entry.metadata?.url) {
      const url = document.createElement("span");
      url.className = "activity-url";
      url.textContent = entry.metadata.url;
      item.append(url);
    }
    elements.activityLogList.append(item);
  });
}

function formatTime(value) {
  if (!value) return "暂无";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function readableError(code) {
  const labels = {
    authorization_code_required: "请输入管理后台生成的授权码。",
    invalid_registration_code: "授权码无效、已使用或已过期。",
    invalid_api_origin: "服务端地址格式不正确。",
    invalid_token: "设备令牌已失效，请重新授权。",
    device_revoked: "该设备授权已被删除，请使用新的授权码。",
    capture_busy: "采集任务正在处理，请稍后再试。",
    readme_empty: "项目页面未返回 README 内容。",
    readme_not_found: "项目主页没有找到 README。",
    readme_load_timeout: "README 在 15 秒内未完成加载，请检查网络后重试。",
    github_rate_limited: "GitHub 已限制当前访问，请稍后再试。",
    github_auth_required: "GitHub 要求登录，请先在当前浏览器完成登录。",
    repository_unavailable: "仓库不存在、无权访问或暂时不可用。",
    readme_unavailable: "无法向项目页面发送读取指令，请重新加载扩展。",
    trending_content_script_unavailable: "无法在 Trending 页面加载采集脚本，请刷新页面后继续。",
    trending_tab_closed: "Trending 标签页已关闭，点击继续采集可重新打开。",
    unknown_error: "操作失败，请查看最近错误。"
  };
  return labels[code] || code || "操作失败。";
}

async function ensureApiPermission(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const origin = `${url.protocol}//${url.host}/*`;
    if (await chrome.permissions.contains({ origins: [origin] })) return true;
    return chrome.permissions.request({ origins: [origin] });
  } catch {
    return false;
  }
}

function showMessage(message, tone) {
  elements.message.textContent = message;
  elements.message.dataset.tone = tone;
}

async function initialize() {
  await refreshStatus();
  statusTimer = window.setInterval(refreshStatus, 1000);
  countdownTimer = window.setInterval(renderCountdown, 1000);
}

window.addEventListener("unload", () => {
  window.clearInterval(statusTimer);
  window.clearInterval(countdownTimer);
});

initialize();
