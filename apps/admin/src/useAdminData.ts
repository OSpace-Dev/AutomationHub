import { computed, reactive, ref } from "vue";
import type { ApiResponse, ConnectionState, Device, DeviceAuthorization, Item, PageMeta, Run, RuntimeLog, Status, Task, TaskSchedule } from "./admin-models";

export const apiOrigin = ref(sessionStorage.getItem("automationhub.apiOrigin") ?? (import.meta.env.DEV ? "http://localhost:3000" : window.location.origin));
export const adminApiKey = ref(sessionStorage.getItem("automationhub.adminApiKey") ?? "");
const showConnectionSettings = ref(true);
const today = new Date().toISOString().slice(0, 10);
const runsDate = ref(today);
const tasksDate = ref(today);
const taskBusinessDate = ref(today);
const runs = ref<Run[]>([]); const devices = ref<Device[]>([]); const monitoringDevices = ref<Device[]>([]); const taskDevices = ref<Device[]>([]); const authorizations = ref<DeviceAuthorization[]>([]); const tasks = ref<Task[]>([]); const schedules = ref<TaskSchedule[]>([]); const logs = ref<RuntimeLog[]>([]); const items = ref<Item[]>([]);
const selectedRun = ref<Run | null>(null); const selectedItem = ref<Item | null>(null); const loading = ref(false); const loadingItems = ref(false); const revokingDeviceId = ref(""); const errorMessage = ref("");
const connectionState = ref<ConnectionState>("disconnected"); const taskDeviceId = ref(""); const creatingTask = ref(false); const cancellingTaskId = ref("");
const authorizationExpiresIn = ref<"24h" | "7d" | "30d" | "never">("24h"); const createdAuthorizationCode = ref(""); const creatingAuthorization = ref(false); const deletingAuthorizationId = ref("");
const taskMode = ref<"immediate" | "once" | "daily">("immediate"); const taskStartAt = ref(defaultStartAt()); const taskTimeZone = ref(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"); const cancellingScheduleId = ref("");
const emptyMeta = (): PageMeta => ({ total: 0, page: 1, page_size: 20, total_pages: 1 });
const pagination = reactive({ runs: emptyMeta(), devices: emptyMeta(), authorizations: emptyMeta(), tasks: emptyMeta(), schedules: emptyMeta(), logs: emptyMeta(), items: emptyMeta() });
const metrics = computed(() => ({ runs: pagination.runs.total, projects: runs.value.reduce((total, run) => total + run.itemCount, 0), success: runs.value.reduce((total, run) => total + run.successCount, 0), failed: runs.value.reduce((total, run) => total + run.failureCount, 0), onlineDevices: devices.value.filter(isDeviceOnline).length, monitoringOnlineDevices: monitoringDevices.value.filter(isDeviceOnline).length, pendingTasks: tasks.value.filter((task) => task.status === "pending" || task.status === "running").length }));
const connectionLabel = computed(() => ({ disconnected: "未连接", connecting: "连接中", online: "服务在线", error: "连接异常" })[connectionState.value]);
export type AdminView = "runs" | "devices" | "tasks" | "monitoring" | "reports" | "models";
type RefreshOptions = { background?: boolean };
type SelectRunOptions = { resetPage?: boolean; preserveSelectedItem?: boolean; background?: boolean };
let itemRequestSequence = 0;

export function useAdminData() { return { apiOrigin, adminApiKey, showConnectionSettings, runsDate, tasksDate, taskBusinessDate, runs, devices, taskDevices, authorizations, tasks, schedules, logs, items, selectedRun, selectedItem, loading, loadingItems, revokingDeviceId, cancellingTaskId, errorMessage, connectionState, taskDeviceId, creatingTask, authorizationExpiresIn, createdAuthorizationCode, creatingAuthorization, deletingAuthorizationId, taskMode, taskStartAt, taskTimeZone, cancellingScheduleId, metrics, pagination, connectionLabel, connect, refreshView, changeDate, selectRun, clearRunSelection, createAuthorization, deleteAuthorization, copyAuthorizationCode, createTask, cancelTask, cancelSchedule, revokeDevice, changePage, formatTime, statusLabel, isDeviceOnline, deviceStatusLabel }; }
async function connect(view: AdminView) { sessionStorage.setItem("automationhub.apiOrigin", apiOrigin.value.replace(/\/$/, "")); if (adminApiKey.value) sessionStorage.setItem("automationhub.adminApiKey", adminApiKey.value); else sessionStorage.removeItem("automationhub.adminApiKey"); connectionState.value = "connecting"; await refreshView(view); if (!errorMessage.value) showConnectionSettings.value = false; }
async function changeDate(scope: "runs" | "tasks") { if (scope === "runs") { pagination.runs.page = 1; clearRunSelection(); await refreshView("runs"); } else { pagination.tasks.page = 1; await refreshView("tasks"); } }
async function refreshView(view: AdminView, options: RefreshOptions = {}) {
  if (options.background && loading.value) return;
  errorMessage.value = "";
  if (!options.background) loading.value = true;
  try {
    if (view === "runs") await refreshRuns(options);
    else if (view === "devices") await refreshDevices();
    else if (view === "tasks") await refreshTasks();
    else if (view === "monitoring") await refreshMonitoring();
    connectionState.value = "online";
  } catch (error) {
    connectionState.value = "error";
    errorMessage.value = error instanceof Error ? error.message : "无法读取管理数据。";
  } finally {
    if (!options.background) loading.value = false;
  }
}
async function refreshRuns(options: RefreshOptions) {
  const response = await apiFetch<Run[]>(pagePath(`/api/v1/admin/runs?date=${encodeURIComponent(runsDate.value)}`, pagination.runs));
  runs.value = response.data;
  Object.assign(pagination.runs, response.meta ?? localMeta(response.data, pagination.runs));
  if (!selectedRun.value) return;
  const refreshedRun = runs.value.find((run) => run.id === selectedRun.value?.id);
  if (!refreshedRun) { if (!options.background) clearRunSelection(); return; }
  if (options.background && loadingItems.value) return;
  await selectRun(refreshedRun, { resetPage: false, preserveSelectedItem: true, background: options.background });
}
async function refreshDevices() {
  const [deviceResponse, authorizationResponse] = await Promise.all([
    apiFetch<Device[]>(pagePath("/api/v1/admin/devices", pagination.devices)),
    apiFetch<DeviceAuthorization[]>(pagePath("/api/v1/admin/authorizations", pagination.authorizations)),
  ]);
  devices.value = deviceResponse.data;
  authorizations.value = authorizationResponse.data;
  Object.assign(pagination.devices, deviceResponse.meta ?? localMeta(deviceResponse.data, pagination.devices));
  Object.assign(pagination.authorizations, authorizationResponse.meta ?? localMeta(authorizationResponse.data, pagination.authorizations));
}
async function refreshTasks() {
  const [taskResponse, deviceResponse, scheduleResponse] = await Promise.all([
    apiFetch<Task[]>(pagePath(`/api/v1/admin/tasks?date=${encodeURIComponent(tasksDate.value)}`, pagination.tasks)),
    apiFetch<Device[]>("/api/v1/admin/devices?page=1&page_size=100"),
    apiFetch<TaskSchedule[]>(pagePath("/api/v1/admin/schedules", pagination.schedules)),
  ]);
  tasks.value = taskResponse.data;
  taskDevices.value = deviceResponse.data;
  schedules.value = scheduleResponse.data;
  Object.assign(pagination.tasks, taskResponse.meta ?? localMeta(taskResponse.data, pagination.tasks));
  Object.assign(pagination.schedules, scheduleResponse.meta ?? localMeta(scheduleResponse.data, pagination.schedules));
  if (!taskDeviceId.value) taskDeviceId.value = taskDevices.value.find((device) => device.status === "active")?.id ?? "";
}
async function refreshMonitoring() {
  const [logResponse, deviceResponse] = await Promise.all([
    apiFetch<RuntimeLog[]>(pagePath("/api/v1/admin/logs", pagination.logs)),
    apiFetch<Device[]>("/api/v1/admin/devices?page=1&page_size=100"),
  ]);
  logs.value = logResponse.data;
  monitoringDevices.value = deviceResponse.data;
  Object.assign(pagination.logs, logResponse.meta ?? localMeta(logResponse.data, pagination.logs));
}
async function selectRun(run: Run, options: SelectRunOptions = {}) {
  const { resetPage = true, preserveSelectedItem = false, background = false } = options;
  const itemBeforeRefresh = preserveSelectedItem ? selectedItem.value : null;
  const requestSequence = ++itemRequestSequence;
  selectedRun.value = run;
  if (!preserveSelectedItem) selectedItem.value = null;
  if (resetPage) Object.assign(pagination.items, emptyMeta());
  if (!background) loadingItems.value = true;
  errorMessage.value = "";
  try {
    const response = await apiFetch<Item[]>(pagePath(`/api/v1/admin/runs/${encodeURIComponent(run.id)}/items`, pagination.items));
    if (requestSequence !== itemRequestSequence || selectedRun.value?.id !== run.id) return;
    items.value = response.data;
    Object.assign(pagination.items, response.meta ?? localMeta(response.data, pagination.items));
    if (itemBeforeRefresh && selectedItem.value?.id === itemBeforeRefresh.id) {
      selectedItem.value = response.data.find((item) => item.id === itemBeforeRefresh.id) ?? itemBeforeRefresh;
    }
  } catch (error) {
    if (requestSequence !== itemRequestSequence) return;
    items.value = [];
    errorMessage.value = error instanceof Error ? error.message : "无法读取项目结果。";
  } finally {
    if (!background && requestSequence === itemRequestSequence) loadingItems.value = false;
  }
}
function clearRunSelection() { itemRequestSequence += 1; selectedRun.value = null; selectedItem.value = null; items.value = []; loadingItems.value = false; Object.assign(pagination.items, emptyMeta()); }
async function createAuthorization() { creatingAuthorization.value = true; createdAuthorizationCode.value = ""; errorMessage.value = ""; try { const response = await apiFetch<{ authorization: DeviceAuthorization; code: string }>("/api/v1/admin/authorizations", { method: "POST", body: JSON.stringify({ expires_in: authorizationExpiresIn.value }) }); createdAuthorizationCode.value = response.data.code; pagination.authorizations.page = 1; await refreshView("devices"); } catch (error) { errorMessage.value = error instanceof Error ? error.message : "授权创建失败。"; } finally { creatingAuthorization.value = false; } }
async function deleteAuthorization(authorization: DeviceAuthorization) { if (!window.confirm(authorization.device_id ? "删除该授权会同时撤销已连接的插件，历史数据仍会保留。确认继续吗？" : "确认删除该未使用授权吗？")) return; deletingAuthorizationId.value = authorization.id; errorMessage.value = ""; try { await apiFetch(`/api/v1/admin/authorizations/${encodeURIComponent(authorization.id)}`, { method: "DELETE" }); if (createdAuthorizationCode.value.endsWith(authorization.code_hint)) createdAuthorizationCode.value = ""; await refreshView("devices"); } catch (error) { errorMessage.value = error instanceof Error ? error.message : "授权删除失败。"; } finally { deletingAuthorizationId.value = ""; } }
async function copyAuthorizationCode() { if (!createdAuthorizationCode.value) return; await navigator.clipboard.writeText(createdAuthorizationCode.value); }
async function createTask() { if (!taskDeviceId.value) { errorMessage.value = "请先选择一个有效设备。"; return; } creatingTask.value = true; errorMessage.value = ""; try { if (taskMode.value === "immediate") { await apiFetch<Task>("/api/v1/admin/tasks", { method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ device_id: taskDeviceId.value, type: "capture_trending", business_date: taskBusinessDate.value }) }); tasksDate.value = taskBusinessDate.value; pagination.tasks.page = 1; } else { const startAt = new Date(taskStartAt.value); if (!Number.isFinite(startAt.getTime())) throw new Error("请选择有效的执行时间。"); await apiFetch<TaskSchedule>("/api/v1/admin/schedules", { method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ device_id: taskDeviceId.value, type: "capture_trending", recurrence: taskMode.value, start_at: startAt.toISOString(), time_zone: taskTimeZone.value }) }); pagination.schedules.page = 1; taskStartAt.value = defaultStartAt(); } await refreshView("tasks"); } catch (error) { errorMessage.value = error instanceof Error ? error.message : "任务创建失败。"; } finally { creatingTask.value = false; } }
async function cancelTask(task: Task) { if (!["pending", "running", "paused"].includes(task.status)) return; if (!window.confirm(`确认取消任务“${task.id}”吗？插件将在下一次心跳时停止执行。`)) return; cancellingTaskId.value = task.id; errorMessage.value = ""; try { await apiFetch<Task>(`/api/v1/admin/tasks/${encodeURIComponent(task.id)}:cancel`, { method: "POST" }); await refreshView("tasks"); } catch (error) { errorMessage.value = error instanceof Error ? error.message : "任务取消失败。"; } finally { cancellingTaskId.value = ""; } }
async function cancelSchedule(schedule: TaskSchedule) { if (schedule.status !== "active" || !window.confirm("确认停用该计划吗？已经生成的任务不会被删除。")) return; cancellingScheduleId.value = schedule.id; errorMessage.value = ""; try { await apiFetch<TaskSchedule>(`/api/v1/admin/schedules/${encodeURIComponent(schedule.id)}`, { method: "DELETE" }); await refreshView("tasks"); } catch (error) { errorMessage.value = error instanceof Error ? error.message : "计划停用失败。"; } finally { cancellingScheduleId.value = ""; } }
async function revokeDevice(device: Device) { if (!window.confirm(`确认撤销设备“${device.name}”吗？撤销后该设备将无法继续上传。`)) return; revokingDeviceId.value = device.id; errorMessage.value = ""; try { await apiFetch(`/api/v1/admin/devices/${encodeURIComponent(device.id)}:revoke`, { method: "POST" }); await refreshView("devices"); } catch (error) { errorMessage.value = error instanceof Error ? error.message : "设备撤销失败。"; } finally { revokingDeviceId.value = ""; } }
async function changePage(kind: keyof typeof pagination, page: number) { const state = pagination[kind]; const target = Math.min(Math.max(page, 1), state.total_pages); if (target === state.page && state.total === 0) return; state.page = target; if (kind === "items" && selectedRun.value) await selectRun(selectedRun.value, { resetPage: false }); else if (kind === "runs") await refreshView("runs"); else if (kind === "devices" || kind === "authorizations") await refreshView("devices"); else if (kind === "tasks" || kind === "schedules") await refreshView("tasks"); else await refreshView("monitoring"); }
export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}) { const response = await fetch(`${apiOrigin.value.replace(/\/$/, "")}${path}`, { ...init, headers: { "content-type": "application/json", ...(adminApiKey.value ? { "x-admin-key": adminApiKey.value } : {}), ...(init.headers ?? {}) } }); const body = await response.json() as ApiResponse<T>; if (!response.ok) throw new Error(body.message || body.code || "管理 API 请求失败。"); return body; }
export function pagePath(path: string, state: PageMeta) { const joiner = path.includes("?") ? "&" : "?"; return `${path}${joiner}page=${state.page}&page_size=${state.page_size}`; }
function localMeta<T>(items: T[], state: PageMeta): PageMeta { return { total: items.length, page: state.page, page_size: state.page_size, total_pages: Math.max(1, Math.ceil(items.length / state.page_size)) }; }
function formatTime(value?: string) { return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "未上报"; }
function statusLabel(status: Status) { const labels: Record<Status, string> = { success: "成功", failed: "失败", pending: "待处理", running: "进行中", completed: "完成", partial: "部分完成", paused: "已暂停", cancelled: "已取消", active: "有效", used: "已使用", expired: "已过期", revoked: "已撤销" }; return labels[status] ?? status; }
function isDeviceOnline(device: Device) { if (device.status !== "active" || !device.last_heartbeat_at) return false; return Date.now() - new Date(device.last_heartbeat_at).getTime() < 150_000; }
function deviceStatusLabel(device: Device) { if (device.status === "revoked") return "已撤销"; return isDeviceOnline(device) ? "在线" : "离线"; }
function defaultStartAt() { const value = new Date(Date.now() + 60 * 60 * 1000); const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000); return local.toISOString().slice(0, 16); }
