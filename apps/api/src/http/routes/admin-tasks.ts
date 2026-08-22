import { invalidPayload } from "../../errors.js";
import type { RuntimeLogLevel, ScheduleRecurrence, ScheduleStatus, TaskSchedule, TaskStatus, TaskType } from "../../models.js";
import type { HttpContext } from "../context.js";
import { pageMeta, readJson, readPage, readPageSize, requireHeader } from "../request.js";
import { writeJson } from "../response.js";
import { serializeDevice, serializeLog, serializeTask } from "./devices.js";
import { requireObject, requireString } from "../../validation.js";

export async function routeAdminTasks(context: HttpContext): Promise<boolean> {
  const { request, response, url, service, options } = context;

  if (request.method === "POST" && url.pathname === "/api/v1/admin/tasks") {
    const body = requireObject(await readJson(request));
    const result = await service.createTask({ deviceId: requireString(body, "device_id"), type: parseTaskType(requireString(body, "type")), businessDate: requireString(body, "business_date"), idempotencyKey: requireHeader(request, "idempotency-key") });
    writeJson(response, result.created ? 201 : 200, { status: "success", data: serializeTask(result.task), meta: { created: result.created } }, options.corsOrigin);
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/v1/admin/tasks") {
    const tasks = await service.listTasks({ date: url.searchParams.get("date") ?? undefined, deviceId: url.searchParams.get("device_id") ?? undefined, status: url.searchParams.get("status") ? parseTaskStatus(url.searchParams.get("status") as string) : undefined, page: readPage(url), pageSize: url.searchParams.has("page_size") ? readPageSize(url) : undefined });
    writeJson(response, 200, { status: "success", data: tasks.items.map(serializeTask), meta: pageMeta(tasks) }, options.corsOrigin);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/admin/schedules") {
    const body = requireObject(await readJson(request));
    const result = await service.createSchedule({ deviceId: requireString(body, "device_id"), type: parseTaskType(requireString(body, "type")), recurrence: parseScheduleRecurrence(requireString(body, "recurrence")), startAt: requireString(body, "start_at"), timeZone: requireString(body, "time_zone"), idempotencyKey: requireHeader(request, "idempotency-key") });
    writeJson(response, result.created ? 201 : 200, { status: "success", data: serializeSchedule(result.schedule), meta: { created: result.created } }, options.corsOrigin);
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/v1/admin/schedules") {
    const schedules = await service.listSchedules({ deviceId: url.searchParams.get("device_id") ?? undefined, status: url.searchParams.get("status") ? parseScheduleStatus(url.searchParams.get("status") as string) : undefined, recurrence: url.searchParams.get("recurrence") ? parseScheduleRecurrence(url.searchParams.get("recurrence") as string) : undefined, page: readPage(url), pageSize: readPageSize(url) });
    writeJson(response, 200, { status: "success", data: schedules.items.map(serializeSchedule), meta: pageMeta(schedules) }, options.corsOrigin);
    return true;
  }

  const deleteScheduleMatch = url.pathname.match(/^\/api\/v1\/admin\/schedules\/([^/]+)$/);
  if (request.method === "DELETE" && deleteScheduleMatch) {
    const schedule = await service.cancelSchedule(decodeURIComponent(deleteScheduleMatch[1]));
    writeJson(response, 200, { status: "success", data: serializeSchedule(schedule) }, options.corsOrigin);
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/v1/admin/logs") {
    const logs = await service.listLogs({ deviceId: url.searchParams.get("device_id") ?? undefined, level: url.searchParams.get("level") ? parseLogLevel(url.searchParams.get("level") as string) : undefined, limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined, page: readPage(url), pageSize: url.searchParams.has("page_size") ? readPageSize(url) : undefined });
    writeJson(response, 200, { status: "success", data: logs.items.map(serializeLog), meta: pageMeta(logs) }, options.corsOrigin);
    return true;
  }

  const cancelTaskMatch = url.pathname.match(/^\/api\/v1\/admin\/tasks\/([^/]+):cancel$/);
  if (request.method === "POST" && cancelTaskMatch) {
    const task = await service.cancelTask(decodeURIComponent(cancelTaskMatch[1]));
    writeJson(response, 200, { status: "success", data: serializeTask(task) }, options.corsOrigin);
    return true;
  }

  const revokeMatch = url.pathname.match(/^\/api\/v1\/admin\/devices\/([^/]+):revoke$/);
  if (request.method === "POST" && revokeMatch) {
    const device = await service.revokeDevice(decodeURIComponent(revokeMatch[1]));
    writeJson(response, 200, { status: "success", data: serializeDevice(device) }, options.corsOrigin);
    return true;
  }

  return false;
}

function serializeSchedule(schedule: TaskSchedule) {
  return { id: schedule.id, device_id: schedule.deviceId, type: schedule.type, recurrence: schedule.recurrence, status: schedule.status, start_at: schedule.startAt, next_run_at: schedule.nextRunAt, time_zone: schedule.timeZone, created_at: schedule.createdAt, last_triggered_at: schedule.lastTriggeredAt, completed_at: schedule.completedAt, cancelled_at: schedule.cancelledAt };
}

function parseTaskType(value: string): TaskType {
  if (value !== "capture_trending") throw invalidPayload("type must be capture_trending");
  return value;
}

function parseTaskStatus(value: string): TaskStatus {
  const values: TaskStatus[] = ["pending", "running", "paused", "completed", "failed", "cancelled"];
  if (!values.includes(value as TaskStatus)) throw invalidPayload("status is invalid");
  return value as TaskStatus;
}

function parseScheduleRecurrence(value: string): ScheduleRecurrence {
  if (value !== "once" && value !== "daily") throw invalidPayload("recurrence must be once or daily");
  return value;
}

function parseScheduleStatus(value: string): ScheduleStatus {
  const values: ScheduleStatus[] = ["active", "completed", "cancelled"];
  if (!values.includes(value as ScheduleStatus)) throw invalidPayload("schedule status is invalid");
  return value as ScheduleStatus;
}

function parseLogLevel(value: string): RuntimeLogLevel {
  const values: RuntimeLogLevel[] = ["info", "warn", "error"];
  if (!values.includes(value as RuntimeLogLevel)) throw invalidPayload("level is invalid");
  return value as RuntimeLogLevel;
}
