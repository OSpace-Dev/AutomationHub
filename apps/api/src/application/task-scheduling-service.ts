import { createId } from "../crypto.js";
import { ApiError, invalidPayload } from "../errors.js";
import type { CollectionTask, Device, ScheduleRecurrence, StoreData, TaskSchedule, TaskStatus, TaskType } from "../models.js";
import type { Store } from "../store.js";
import { DeviceAuthService } from "./device-auth-service.js";
import { RuntimeLogService } from "./runtime-log-service.js";

const TASK_LEASE_TIMEOUT_MS = 2 * 60 * 1000;

export class TaskSchedulingService {
  private readonly deviceAuth: DeviceAuthService;

  constructor(private readonly store: Store, private readonly runtimeLogs: RuntimeLogService) {
    this.deviceAuth = new DeviceAuthService(store);
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
          this.runtimeLogs.appendLogToData(data, { deviceId, taskId: staleTask.id, level: "warn", event: "task_requeued", message: "Task lease expired and was returned to the queue" });
        }
      }
      if (data.tasks.some((entry) => entry.deviceId === deviceId && entry.status === "running")) return null;
      const task = data.tasks.filter((entry) => entry.deviceId === deviceId && entry.status === "pending").sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (!task) return null;
      task.status = "running";
      task.claimedAt = new Date().toISOString();
      task.lastHeartbeatAt = task.claimedAt;
      this.runtimeLogs.appendLogToData(data, { deviceId, taskId: task.id, level: "info", event: "task_claimed", message: "Collection task claimed by device" });
      return structuredClone(task);
    });
  }

  async updateTask(deviceId: string, taskId: string, input: { status: TaskStatus; runId?: string; errorCode?: string }): Promise<CollectionTask> {
    return this.store.update((data) => {
      this.requireActiveDevice(data, deviceId);
      const task = data.tasks.find((entry) => entry.id === taskId && entry.deviceId === deviceId);
      if (!task) throw new ApiError(404, "task_not_found", "Task was not found");
      if (task.status !== input.status && !isAllowedTaskTransition(task.status, input.status)) throw new ApiError(409, "invalid_task_transition", `Cannot change task status from ${task.status} to ${input.status}`);
      const effectiveRunId = input.runId ?? task.runId;
      if (input.status === "completed" && !effectiveRunId) throw invalidPayload("run_id is required when completing a collection task");
      if (effectiveRunId) {
        const run = data.runs.find((entry) => entry.id === effectiveRunId && entry.deviceId === deviceId);
        if (!run) throw new ApiError(404, "run_not_found", "Collection run was not found", true);
        if (run.businessDate !== task.businessDate) throw new ApiError(409, "task_run_mismatch", "Collection run business date does not match the task");
      }
      task.status = input.status;
      if (input.runId) task.runId = input.runId;
      if (input.errorCode) task.errorCode = input.errorCode;
      if (["completed", "failed", "cancelled"].includes(input.status)) {
        task.completedAt = new Date().toISOString();
        task.lastHeartbeatAt = undefined;
      }
      this.runtimeLogs.appendLogToData(data, { deviceId, taskId, level: input.status === "failed" ? "error" : "info", event: "task_status_changed", message: `Collection task status changed to ${input.status}`, metadata: { status: input.status, error_code: input.errorCode ?? null } });
      return structuredClone(task);
    });
  }

  async cancelTask(taskId: string): Promise<CollectionTask> {
    return this.store.update((data) => {
      const task = data.tasks.find((entry) => entry.id === taskId);
      if (!task) throw new ApiError(404, "task_not_found", "Task was not found");
      if (!["pending", "running", "paused"].includes(task.status)) throw new ApiError(409, "task_not_cancellable", "Only pending, running, or paused tasks can be cancelled");
      task.status = "cancelled";
      task.completedAt = new Date().toISOString();
      task.lastHeartbeatAt = undefined;
      this.runtimeLogs.appendLogToData(data, { deviceId: task.deviceId, taskId: task.id, level: "warn", event: "task_cancelled", message: "Collection task cancelled by admin" });
      return structuredClone(task);
    });
  }

  requireActiveDevice(data: StoreData, deviceId: string): Device {
    return this.deviceAuth.requireActiveDevice(data, deviceId);
  }

  private createTaskInData(data: StoreData, input: { deviceId: string; type: TaskType; businessDate: string; idempotencyKey: string; scheduleId?: string }): { task: CollectionTask; created: boolean } {
    const existing = data.tasks.find((task) => task.deviceId === input.deviceId && task.idempotencyKey === input.idempotencyKey);
    if (existing) return { task: structuredClone(existing), created: false };
    const task: CollectionTask = { id: createId(), deviceId: input.deviceId, type: input.type, status: "pending", businessDate: input.businessDate, idempotencyKey: input.idempotencyKey, createdAt: new Date().toISOString(), scheduleId: input.scheduleId };
    data.tasks.push(task);
    this.runtimeLogs.appendLogToData(data, { deviceId: input.deviceId, taskId: task.id, level: "info", event: input.scheduleId ? "scheduled_task_created" : "task_created", message: input.scheduleId ? "Collection task created from schedule" : "Collection task created by admin", metadata: input.scheduleId ? { schedule_id: input.scheduleId } : undefined });
    return { task: structuredClone(task), created: true };
  }

  private materializeDueSchedules(data: StoreData, deviceId: string, now: Date): void {
    for (const schedule of data.schedules.filter((entry) => entry.deviceId === deviceId && entry.status === "active" && entry.nextRunAt && new Date(entry.nextRunAt) <= now)) {
      const scheduledAt = schedule.nextRunAt as string;
      this.createTaskInData(data, { deviceId, type: schedule.type, businessDate: formatBusinessDate(new Date(scheduledAt), schedule.timeZone), idempotencyKey: `schedule:${schedule.id}:${scheduledAt}`, scheduleId: schedule.id });
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
}

function isAllowedTaskTransition(from: TaskStatus, to: TaskStatus): boolean {
  const allowed: Record<TaskStatus, TaskStatus[]> = { pending: ["running", "cancelled"], running: ["paused", "completed", "failed", "cancelled"], paused: ["running", "failed", "cancelled"], completed: [], failed: [], cancelled: [] };
  return allowed[from].includes(to);
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
    local = { year: String(nextDate.getUTCFullYear()).padStart(4, "0"), month: String(nextDate.getUTCMonth() + 1).padStart(2, "0"), day: String(nextDate.getUTCDate()).padStart(2, "0"), hour: String(nextDate.getUTCHours()).padStart(2, "0"), minute: String(nextDate.getUTCMinutes()).padStart(2, "0"), second: String(nextDate.getUTCSeconds()).padStart(2, "0") };
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
