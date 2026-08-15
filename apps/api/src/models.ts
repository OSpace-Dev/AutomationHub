export type DeviceStatus = "active" | "revoked";
export type RunStatus = "pending" | "running" | "completed" | "partial";
export type ItemStatus = "success" | "failed";
export type TaskType = "capture_trending";
export type TaskStatus = "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";
export type ScheduleRecurrence = "once" | "daily";
export type ScheduleStatus = "active" | "completed" | "cancelled";
export type RuntimeLogLevel = "info" | "warn" | "error";

export interface RegistrationCode {
  id: string;
  codeHash: string;
  codeHint?: string;
  createdAt?: string;
  expiresAt?: string;
  usedAt?: string;
  revokedAt?: string;
  deviceId?: string;
}

export interface Device {
  id: string;
  name: string;
  extensionVersion: string;
  registeredAt: string;
  lastHeartbeatAt?: string;
  queueDepth: number;
  status: DeviceStatus;
  revokedAt?: string;
  registrationCodeId?: string;
}

export interface DeviceToken {
  id: string;
  deviceId: string;
  tokenHash: string;
  kind: "access" | "refresh";
  expiresAt: string;
  revokedAt?: string;
}

export interface CollectionRun {
  id: string;
  deviceId: string;
  businessDate: string;
  sourceUrl: string;
  filters: Record<string, string>;
  idempotencyKey: string;
  status: RunStatus;
  itemCount: number;
  successCount: number;
  failureCount: number;
  createdAt: string;
}

export interface CollectionTask {
  id: string;
  deviceId: string;
  type: TaskType;
  status: TaskStatus;
  businessDate: string;
  idempotencyKey: string;
  runId?: string;
  createdAt: string;
  claimedAt?: string;
  lastHeartbeatAt?: string;
  completedAt?: string;
  errorCode?: string;
  scheduleId?: string;
}

export interface TaskSchedule {
  id: string;
  deviceId: string;
  type: TaskType;
  recurrence: ScheduleRecurrence;
  status: ScheduleStatus;
  startAt: string;
  nextRunAt?: string;
  timeZone: string;
  idempotencyKey: string;
  createdAt: string;
  lastTriggeredAt?: string;
  completedAt?: string;
  cancelledAt?: string;
}

export interface RuntimeLog {
  id: string;
  deviceId: string;
  taskId?: string;
  level: RuntimeLogLevel;
  event: string;
  message: string;
  metadata?: Record<string, string | number | boolean | null>;
  occurredAt: string;
}

export interface ProjectSnapshot {
  id: string;
  runId: string;
  projectUrl: string;
  normalizedProjectUrl: string;
  rank: number;
  name: string;
  readmeHtml: string;
  readmeText: string;
  contentHash: string;
  readAt: string;
  status: ItemStatus;
  errorCode?: string;
}

export interface StoreData {
  registrationCodes: RegistrationCode[];
  devices: Device[];
  tokens: DeviceToken[];
  runs: CollectionRun[];
  items: ProjectSnapshot[];
  tasks: CollectionTask[];
  schedules: TaskSchedule[];
  logs: RuntimeLog[];
}

export const EMPTY_STORE: StoreData = {
  registrationCodes: [],
  devices: [],
  tokens: [],
  runs: [],
  items: [],
  tasks: [],
  schedules: [],
  logs: []
};
