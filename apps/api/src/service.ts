import { createId, createOpaqueToken, createRegistrationCode, hashContent, hashSecret } from "./crypto.js";
import { ApiError, invalidPayload } from "./errors.js";
import type { CollectionRun, CollectionTask, Device, DeviceToken, ProjectSnapshot, RegistrationCode, RuntimeLog, RuntimeLogLevel, ScheduleRecurrence, StoreData, TaskSchedule, TaskStatus, TaskType } from "./models.js";
import type { Store } from "./store.js";

const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TASK_LEASE_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const AUTHORIZATION_TTLS = { "24h": 24 * 60 * 60 * 1000, "7d": 7 * 24 * 60 * 60 * 1000, "30d": 30 * 24 * 60 * 60 * 1000 } as const;
export type AuthorizationExpiry = keyof typeof AUTHORIZATION_TTLS | "never";

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface TokenPair {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export class CollectionService {
  constructor(private readonly store: Store) {}

  async createRegistrationCode(expiresIn: AuthorizationExpiry): Promise<{ authorization: RegistrationCode; code: string }> {
    return this.store.update((data) => {
      const now = new Date();
      const code = createRegistrationCode();
      const authorization: RegistrationCode = {
        id: createId(),
        codeHash: hashSecret(code),
        codeHint: code.slice(-6),
        createdAt: now.toISOString(),
        expiresAt: expiresIn === "never" ? undefined : new Date(now.getTime() + AUTHORIZATION_TTLS[expiresIn]).toISOString()
      };
      data.registrationCodes.push(authorization);
      return { authorization: structuredClone(authorization), code };
    });
  }

  async listRegistrationCodes(page = 1, pageSize = DEFAULT_PAGE_SIZE): Promise<PageResult<RegistrationCode>> {
    const data = await this.store.read();
    return paginate(data.registrationCodes.filter((entry) => !entry.revokedAt).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")), page, pageSize);
  }

  async revokeRegistrationCode(authorizationId: string): Promise<RegistrationCode> {
    return this.store.update((data) => {
      const authorization = data.registrationCodes.find((entry) => entry.id === authorizationId && !entry.revokedAt);
      if (!authorization) throw new ApiError(404, "authorization_not_found", "Authorization was not found");
      const now = new Date().toISOString();
      authorization.revokedAt = now;
      if (authorization.deviceId) this.revokeDeviceInData(data, authorization.deviceId, now);
      return structuredClone(authorization);
    });
  }

  async registerDevelopmentDevice(input: { id?: string; name: string; extensionVersion: string }): Promise<Device> {
    return this.store.update((data) => {
      const existing = input.id ? data.devices.find((entry) => entry.id === input.id && entry.status === "active") : undefined;
      if (existing) {
        existing.name = input.name;
        existing.extensionVersion = input.extensionVersion;
        return structuredClone(existing);
      }
      const now = new Date().toISOString();
      const device: Device = {
        id: input.id || createId(),
        name: input.name,
        extensionVersion: input.extensionVersion,
        registeredAt: now,
        queueDepth: 0,
        status: "active"
      };
      data.devices.push(device);
      return structuredClone(device);
    });
  }

  async authenticateDevelopmentDevice(deviceId: string): Promise<Device> {
    const data = await this.store.read();
    return this.requireActiveDevice(data, deviceId);
  }

  async registerDevice(input: { code: string; name: string; extensionVersion: string }): Promise<{ device: Device; tokens: TokenPair }> {
    return this.store.update((data) => {
      const now = new Date();
      const registration = data.registrationCodes.find((entry) => entry.codeHash === hashSecret(input.code));
      if (!registration || registration.revokedAt || registration.usedAt || (registration.expiresAt && new Date(registration.expiresAt) <= now)) {
        throw new ApiError(401, "invalid_registration_code", "Registration code is invalid, expired, or already used");
      }

      registration.usedAt = now.toISOString();
      const device: Device = {
        id: createId(),
        name: input.name,
        extensionVersion: input.extensionVersion,
        registeredAt: now.toISOString(),
        queueDepth: 0,
        status: "active",
        registrationCodeId: registration.id
      };
      data.devices.push(device);
      registration.deviceId = device.id;
      return { device, tokens: this.issueTokens(data, device.id, now) };
    });
  }

  async refreshDeviceToken(refreshToken: string): Promise<TokenPair> {
    return this.store.update((data) => {
      const now = new Date();
      const token = this.findValidToken(data, refreshToken, "refresh", now);
      token.revokedAt = now.toISOString();
      return this.issueTokens(data, token.deviceId, now);
    });
  }

  async authenticate(accessToken: string): Promise<Device> {
    const data = await this.store.read();
    const token = this.findValidToken(data, accessToken, "access", new Date());
    const device = data.devices.find((entry) => entry.id === token.deviceId);
    if (!device || device.status !== "active") {
      throw new ApiError(403, "device_revoked", "Device is revoked");
    }
    return device;
  }

  async heartbeat(deviceId: string, input: { extensionVersion: string; queueDepth: number; taskId?: string }): Promise<Device & { taskCancelled?: boolean }> {
    return this.store.update((data) => {
      const device = this.requireActiveDevice(data, deviceId);
      device.extensionVersion = input.extensionVersion;
      device.queueDepth = input.queueDepth;
      const occurredAt = new Date().toISOString();
      device.lastHeartbeatAt = occurredAt;
      let taskCancelled = false;
      if (input.taskId) {
        const task = data.tasks.find((entry) => entry.id === input.taskId && entry.deviceId === deviceId);
        taskCancelled = task?.status === "cancelled";
        if (task && ["running", "paused"].includes(task.status)) task.lastHeartbeatAt = occurredAt;
      }
      this.appendLogToData(data, {
        deviceId,
        level: "info",
        event: "heartbeat",
        message: "Device heartbeat received",
        metadata: { extension_version: input.extensionVersion, queue_depth: input.queueDepth },
        occurredAt
      });
      return { ...structuredClone(device), taskCancelled };
    });
  }

  async createTask(input: { deviceId: string; type: TaskType; businessDate: string; idempotencyKey: string }): Promise<{ task: CollectionTask; created: boolean }> {
    return this.store.update((data) => {
      this.requireActiveDevice(data, input.deviceId);
      return this.createTaskInData(data, input);
    });
  }

  async createSchedule(input: { deviceId: string; type: TaskType; recurrence: ScheduleRecurrence; startAt: string; timeZone: string; idempotencyKey: string }): Promise<{ schedule: TaskSchedule; created: boolean }> {
    return this.store.update((data) => {
      this.requireActiveDevice(data, input.deviceId);
      const existing = data.schedules.find((entry) => entry.deviceId === input.deviceId && entry.idempotencyKey === input.idempotencyKey);
      if (existing) return { schedule: structuredClone(existing), created: false };
      const startAt = new Date(input.startAt);
      if (!Number.isFinite(startAt.getTime()) || startAt.getTime() <= Date.now()) throw invalidPayload("start_at must be a future ISO 8601 time");
      assertTimeZone(input.timeZone);
      const schedule: TaskSchedule = {
        id: createId(),
        deviceId: input.deviceId,
        type: input.type,
        recurrence: input.recurrence,
        status: "active",
        startAt: startAt.toISOString(),
        nextRunAt: startAt.toISOString(),
        timeZone: input.timeZone,
        idempotencyKey: input.idempotencyKey,
        createdAt: new Date().toISOString()
      };
      data.schedules.push(schedule);
      return { schedule: structuredClone(schedule), created: true };
    });
  }

  async listSchedules(page = 1, pageSize = DEFAULT_PAGE_SIZE): Promise<PageResult<TaskSchedule>> {
    const data = await this.store.read();
    return paginate(data.schedules.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), page, pageSize);
  }

  async cancelSchedule(scheduleId: string): Promise<TaskSchedule> {
    return this.store.update((data) => {
      const schedule = data.schedules.find((entry) => entry.id === scheduleId);
      if (!schedule) throw new ApiError(404, "schedule_not_found", "Schedule was not found");
      if (schedule.status !== "active") throw new ApiError(409, "schedule_not_active", "Only active schedules can be cancelled");
      schedule.status = "cancelled";
      schedule.cancelledAt = new Date().toISOString();
      schedule.nextRunAt = undefined;
      return structuredClone(schedule);
    });
  }

  async claimNextTask(deviceId: string): Promise<CollectionTask | null> {
    return this.store.update((data) => {
      this.requireActiveDevice(data, deviceId);
      this.materializeDueSchedules(data, deviceId, new Date());
      const leaseCutoff = Date.now() - TASK_LEASE_TIMEOUT_MS;
      for (const staleTask of data.tasks.filter((entry) => entry.deviceId === deviceId && entry.status === "running")) {
        const lastSeen = new Date(staleTask.lastHeartbeatAt ?? staleTask.claimedAt ?? staleTask.createdAt).getTime();
        if (lastSeen <= leaseCutoff) {
          staleTask.status = "pending";
          staleTask.claimedAt = undefined;
          staleTask.lastHeartbeatAt = undefined;
          this.appendLogToData(data, {
            deviceId,
            taskId: staleTask.id,
            level: "warn",
            event: "task_requeued",
            message: "Task lease expired and was returned to the queue"
          });
        }
      }
      if (data.tasks.some((entry) => entry.deviceId === deviceId && entry.status === "running")) return null;
      const task = data.tasks
        .filter((entry) => entry.deviceId === deviceId && entry.status === "pending")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (!task) return null;
      task.status = "running";
      task.claimedAt = new Date().toISOString();
      task.lastHeartbeatAt = task.claimedAt;
      this.appendLogToData(data, {
        deviceId,
        taskId: task.id,
        level: "info",
        event: "task_claimed",
        message: "Collection task claimed by device"
      });
      return structuredClone(task);
    });
  }

  async updateTask(deviceId: string, taskId: string, input: { status: TaskStatus; runId?: string; errorCode?: string }): Promise<CollectionTask> {
    return this.store.update((data) => {
      this.requireActiveDevice(data, deviceId);
      const task = data.tasks.find((entry) => entry.id === taskId && entry.deviceId === deviceId);
      if (!task) throw new ApiError(404, "task_not_found", "Task was not found");
      if (task.status !== input.status && !isAllowedTaskTransition(task.status, input.status)) {
        throw new ApiError(409, "invalid_task_transition", `Cannot change task status from ${task.status} to ${input.status}`);
      }
      const effectiveRunId = input.runId ?? task.runId;
      if (input.status === "completed" && !effectiveRunId) {
        throw invalidPayload("run_id is required when completing a collection task");
      }
      if (effectiveRunId) {
        const run = data.runs.find((entry) => entry.id === effectiveRunId && entry.deviceId === deviceId);
        if (!run) throw new ApiError(404, "run_not_found", "Collection run was not found", true);
        if (run.businessDate !== task.businessDate) {
          throw new ApiError(409, "task_run_mismatch", "Collection run business date does not match the task");
        }
      }
      task.status = input.status;
      if (input.runId) task.runId = input.runId;
      if (input.errorCode) task.errorCode = input.errorCode;
      if (["completed", "failed", "cancelled"].includes(input.status)) task.completedAt = new Date().toISOString();
      if (["completed", "failed", "cancelled"].includes(input.status)) task.lastHeartbeatAt = undefined;
      this.appendLogToData(data, {
        deviceId,
        taskId,
        level: input.status === "failed" ? "error" : "info",
        event: "task_status_changed",
        message: `Collection task status changed to ${input.status}`,
        metadata: { status: input.status, error_code: input.errorCode ?? null }
      });
      return structuredClone(task);
    });
  }

  async cancelTask(taskId: string): Promise<CollectionTask> {
    return this.store.update((data) => {
      const task = data.tasks.find((entry) => entry.id === taskId);
      if (!task) throw new ApiError(404, "task_not_found", "Task was not found");
      if (!["pending", "running", "paused"].includes(task.status)) {
        throw new ApiError(409, "task_not_cancellable", "Only pending, running, or paused tasks can be cancelled");
      }
      task.status = "cancelled";
      task.completedAt = new Date().toISOString();
      task.lastHeartbeatAt = undefined;
      this.appendLogToData(data, {
        deviceId: task.deviceId,
        taskId: task.id,
        level: "warn",
        event: "task_cancelled",
        message: "Collection task cancelled by admin"
      });
      return structuredClone(task);
    });
  }

  async appendLog(input: { deviceId: string; taskId?: string; level: RuntimeLogLevel; event: string; message: string; metadata?: Record<string, string | number | boolean | null> }): Promise<RuntimeLog> {
    return this.store.update((data) => {
      this.requireActiveDevice(data, input.deviceId);
      return structuredClone(this.appendLogToData(data, input));
    });
  }

  async createRun(deviceId: string, input: { businessDate: string; sourceUrl: string; filters: Record<string, string>; idempotencyKey: string }): Promise<{ run: CollectionRun; created: boolean }> {
    return this.store.update((data) => {
      this.requireActiveDevice(data, deviceId);
      const existing = data.runs.find((run) => run.deviceId === deviceId && run.idempotencyKey === input.idempotencyKey);
      if (existing) return { run: structuredClone(existing), created: false };

      const run: CollectionRun = {
        id: createId(),
        deviceId,
        businessDate: input.businessDate,
        sourceUrl: input.sourceUrl,
        filters: input.filters,
        idempotencyKey: input.idempotencyKey,
        status: "running",
        itemCount: 0,
        successCount: 0,
        failureCount: 0,
        createdAt: new Date().toISOString()
      };
      data.runs.push(run);
      return { run: structuredClone(run), created: true };
    });
  }

  async uploadItems(deviceId: string, runId: string, items: Array<Omit<ProjectSnapshot, "id" | "runId" | "normalizedProjectUrl" | "contentHash">>): Promise<{ accepted: number; duplicates: number }> {
    return this.store.update((data) => {
      const run = data.runs.find((entry) => entry.id === runId && entry.deviceId === deviceId);
      if (!run) throw new ApiError(404, "run_not_found", "Collection run was not found", true);

      let accepted = 0;
      let duplicates = 0;
      for (const input of items) {
        const normalizedProjectUrl = normalizeProjectUrl(input.projectUrl);
        if (data.items.some((item) => item.runId === runId && item.normalizedProjectUrl === normalizedProjectUrl)) {
          duplicates += 1;
          continue;
        }
        const snapshot: ProjectSnapshot = {
          ...input,
          id: createId(),
          runId,
          normalizedProjectUrl,
          contentHash: hashContent(`${input.readmeHtml}\n${input.readmeText}`)
        };
        data.items.push(snapshot);
        accepted += 1;
      }
      this.updateRunCounts(data, run);
      return { accepted, duplicates };
    });
  }

  async listRuns(date?: string, page = 1, pageSize = DEFAULT_PAGE_SIZE): Promise<PageResult<CollectionRun>> {
    const data = await this.store.read();
    return paginate(data.runs.filter((run) => !date || run.businessDate === date).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), page, pageSize);
  }

  async listItems(runId: string, page = 1, pageSize = DEFAULT_PAGE_SIZE): Promise<PageResult<ProjectSnapshot>> {
    const data = await this.store.read();
    if (!data.runs.some((run) => run.id === runId)) throw new ApiError(404, "run_not_found", "Collection run was not found");
    return paginate(data.items.filter((item) => item.runId === runId).sort((a, b) => a.rank - b.rank), page, pageSize);
  }

  async listDevices(page = 1, pageSize = DEFAULT_PAGE_SIZE): Promise<PageResult<Device>> {
    const data = await this.store.read();
    return paginate(data.devices.sort((a, b) => b.registeredAt.localeCompare(a.registeredAt)), page, pageSize);
  }

  async listTasks(input: { date?: string; deviceId?: string; status?: TaskStatus; page?: number; pageSize?: number }): Promise<PageResult<CollectionTask>> {
    const data = await this.store.read();
    return paginate(data.tasks
      .filter((task) => (!input.date || task.businessDate === input.date) && (!input.deviceId || task.deviceId === input.deviceId) && (!input.status || task.status === input.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)), input.page, input.pageSize);
  }

  async listLogs(input: { deviceId?: string; level?: RuntimeLogLevel; limit?: number; page?: number; pageSize?: number }): Promise<PageResult<RuntimeLog>> {
    const data = await this.store.read();
    return paginate(data.logs
      .filter((log) => (!input.deviceId || log.deviceId === input.deviceId) && (!input.level || log.level === input.level))
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)), input.page, input.pageSize ?? input.limit);
  }

  async revokeDevice(deviceId: string): Promise<Device> {
    return this.store.update((data) => {
      const device = data.devices.find((entry) => entry.id === deviceId);
      if (!device) throw new ApiError(404, "device_not_found", "Device was not found");
      const now = new Date().toISOString();
      this.revokeDeviceInData(data, deviceId, now);
      return structuredClone(device);
    });
  }

  private createTaskInData(data: StoreData, input: { deviceId: string; type: TaskType; businessDate: string; idempotencyKey: string; scheduleId?: string }): { task: CollectionTask; created: boolean } {
    const existing = data.tasks.find((task) => task.deviceId === input.deviceId && task.idempotencyKey === input.idempotencyKey);
    if (existing) return { task: structuredClone(existing), created: false };
    const task: CollectionTask = {
      id: createId(),
      deviceId: input.deviceId,
      type: input.type,
      status: "pending",
      businessDate: input.businessDate,
      idempotencyKey: input.idempotencyKey,
      createdAt: new Date().toISOString(),
      scheduleId: input.scheduleId
    };
    data.tasks.push(task);
    this.appendLogToData(data, {
      deviceId: input.deviceId,
      taskId: task.id,
      level: "info",
      event: input.scheduleId ? "scheduled_task_created" : "task_created",
      message: input.scheduleId ? "Collection task created from schedule" : "Collection task created by admin",
      metadata: input.scheduleId ? { schedule_id: input.scheduleId } : undefined
    });
    return { task: structuredClone(task), created: true };
  }

  private materializeDueSchedules(data: StoreData, deviceId: string, now: Date): void {
    for (const schedule of data.schedules.filter((entry) => entry.deviceId === deviceId && entry.status === "active" && entry.nextRunAt && new Date(entry.nextRunAt) <= now)) {
      const scheduledAt = schedule.nextRunAt as string;
      this.createTaskInData(data, {
        deviceId,
        type: schedule.type,
        businessDate: formatBusinessDate(new Date(scheduledAt), schedule.timeZone),
        idempotencyKey: `schedule:${schedule.id}:${scheduledAt}`,
        scheduleId: schedule.id
      });
      schedule.lastTriggeredAt = now.toISOString();
      if (schedule.recurrence === "once") {
        schedule.status = "completed";
        schedule.completedAt = now.toISOString();
        schedule.nextRunAt = undefined;
      } else {
        schedule.nextRunAt = nextDailyRunAt(new Date(scheduledAt), schedule.timeZone, now).toISOString();
      }
    }
  }

  private revokeDeviceInData(data: StoreData, deviceId: string, revokedAt: string): void {
    const device = data.devices.find((entry) => entry.id === deviceId);
    if (!device) throw new ApiError(404, "device_not_found", "Device was not found");
    device.status = "revoked";
    device.revokedAt = revokedAt;
    for (const token of data.tokens) {
      if (token.deviceId === deviceId && !token.revokedAt) token.revokedAt = revokedAt;
    }
    for (const schedule of data.schedules) {
      if (schedule.deviceId === deviceId && schedule.status === "active") {
        schedule.status = "cancelled";
        schedule.cancelledAt = revokedAt;
        schedule.nextRunAt = undefined;
      }
    }
  }

  private issueTokens(data: StoreData, deviceId: string, now: Date): TokenPair {
    const accessToken = createOpaqueToken();
    const refreshToken = createOpaqueToken();
    const accessTokenExpiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_MS).toISOString();
    const refreshTokenExpiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS).toISOString();
    data.tokens.push(
      { id: createId(), deviceId, tokenHash: hashSecret(accessToken), kind: "access", expiresAt: accessTokenExpiresAt },
      { id: createId(), deviceId, tokenHash: hashSecret(refreshToken), kind: "refresh", expiresAt: refreshTokenExpiresAt }
    );
    return { accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt };
  }

  private findValidToken(data: StoreData, secret: string, kind: DeviceToken["kind"], now: Date): DeviceToken {
    const token = data.tokens.find((entry) => entry.kind === kind && entry.tokenHash === hashSecret(secret));
    if (!token) {
      throw new ApiError(401, "invalid_token", `${kind} token is invalid or expired`);
    }
    const device = data.devices.find((entry) => entry.id === token.deviceId);
    if (!device || device.status !== "active") throw new ApiError(403, "device_revoked", "Device is revoked");
    if (token.revokedAt || new Date(token.expiresAt) <= now) {
      throw new ApiError(401, "invalid_token", `${kind} token is invalid or expired`);
    }
    return token;
  }

  private requireActiveDevice(data: StoreData, deviceId: string): Device {
    const device = data.devices.find((entry) => entry.id === deviceId);
    if (!device || device.status !== "active") throw new ApiError(403, "device_revoked", "Device is revoked");
    return device;
  }

  private updateRunCounts(data: StoreData, run: CollectionRun): void {
    const items = data.items.filter((item) => item.runId === run.id);
    run.itemCount = items.length;
    run.successCount = items.filter((item) => item.status === "success").length;
    run.failureCount = items.filter((item) => item.status === "failed").length;
    run.status = run.failureCount === 0 ? "completed" : run.successCount === 0 ? "partial" : "partial";
  }

  private appendLogToData(data: StoreData, input: Omit<RuntimeLog, "id" | "occurredAt"> & { occurredAt?: string }): RuntimeLog {
    const log: RuntimeLog = {
      id: createId(),
      deviceId: input.deviceId,
      taskId: input.taskId,
      level: input.level,
      event: input.event,
      message: input.message,
      metadata: input.metadata,
      occurredAt: input.occurredAt ?? new Date().toISOString()
    };
    data.logs.push(log);
    return log;
  }
}

function paginate<T>(values: T[], requestedPage = 1, requestedPageSize = DEFAULT_PAGE_SIZE): PageResult<T> {
  const pageSize = Math.min(Math.max(Number.isFinite(requestedPageSize) ? Math.trunc(requestedPageSize) : DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const total = values.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1, 1), totalPages);
  return { items: values.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize, totalPages };
}

function isAllowedTaskTransition(from: TaskStatus, to: TaskStatus): boolean {
  const allowed: Record<TaskStatus, TaskStatus[]> = {
    pending: ["running", "cancelled"],
    running: ["paused", "completed", "failed", "cancelled"],
    paused: ["running", "failed", "cancelled"],
    completed: [],
    failed: [],
    cancelled: []
  };
  return allowed[from].includes(to);
}

function normalizeProjectUrl(projectUrl: string): string {
  let url: URL;
  try {
    url = new URL(projectUrl);
  } catch {
    throw invalidPayload("project_url must be a valid URL");
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com") {
    throw invalidPayload("project_url must be an HTTPS github.com URL");
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 2) throw invalidPayload("project_url must identify a GitHub repository");
  return `https://github.com/${segments[0].toLowerCase()}/${segments[1].toLowerCase()}`;
}

function assertTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
  } catch {
    throw invalidPayload("time_zone must be a valid IANA time zone");
  }
}

function formatBusinessDate(value: Date, timeZone: string): string {
  const values = zonedParts(value, timeZone);
  return `${values.year}-${values.month}-${values.day}`;
}

function nextDailyRunAt(previousRunAt: Date, timeZone: string, now: Date): Date {
  let local = zonedParts(previousRunAt, timeZone);
  let candidate: Date;
  do {
    const nextDate = new Date(Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day) + 1, Number(local.hour), Number(local.minute), Number(local.second)));
    local = {
      year: String(nextDate.getUTCFullYear()).padStart(4, "0"),
      month: String(nextDate.getUTCMonth() + 1).padStart(2, "0"),
      day: String(nextDate.getUTCDate()).padStart(2, "0"),
      hour: String(nextDate.getUTCHours()).padStart(2, "0"),
      minute: String(nextDate.getUTCMinutes()).padStart(2, "0"),
      second: String(nextDate.getUTCSeconds()).padStart(2, "0")
    };
    candidate = localTimeToUtc(local, timeZone);
  } while (candidate <= now);
  return candidate;
}

function zonedParts(value: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(value);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function localTimeToUtc(parts: Record<string, string>, timeZone: string): Date {
  const desired = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  let guess = desired;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const actual = zonedParts(new Date(guess), timeZone);
    const actualValue = Date.UTC(Number(actual.year), Number(actual.month) - 1, Number(actual.day), Number(actual.hour), Number(actual.minute), Number(actual.second));
    const adjustment = desired - actualValue;
    if (adjustment === 0) break;
    guess += adjustment;
  }
  return new Date(guess);
}
