import { CollectionQueryService, type PageResult } from "./collection-query-service.js";
import { DeviceAuthService, type AuthorizationExpiry, type TokenPair } from "./device-auth-service.js";
import { CollectionRunService } from "./collection-run-service.js";
import { TaskSchedulingService } from "./task-scheduling-service.js";
import { DeviceLivenessService } from "./device-liveness-service.js";
import { RuntimeLogService } from "./runtime-log-service.js";
import { StoreBackedCollectionQueryAdapter } from "../infrastructure/persistence/store-backed-collection-query-adapter.js";
import { StoreBackedCollectionWriteAdapter } from "../infrastructure/persistence/store-backed-collection-write-adapter.js";
import type { CollectionRun, CollectionTask, Device, ProjectSnapshot, RegistrationCode, RuntimeLog, RuntimeLogLevel, ScheduleRecurrence, TaskSchedule, TaskStatus, TaskType } from "../domain/models.js";
import type { Store } from "./ports/store.js";

export type { AuthorizationExpiry, TokenPair } from "./device-auth-service.js";

const DEFAULT_PAGE_SIZE = 20;

export type { PageResult } from "./collection-query-service.js";

export class CollectionService {
  private readonly deviceAuth: DeviceAuthService;
  private readonly collectionQueries: CollectionQueryService;
  private readonly collectionRuns: CollectionRunService;
  private readonly taskScheduling: TaskSchedulingService;
  private readonly deviceLiveness: DeviceLivenessService;
  private readonly runtimeLogs: RuntimeLogService;

  constructor(private readonly store: Store) {
    this.deviceAuth = new DeviceAuthService(store);
    const collectionQueries = new StoreBackedCollectionQueryAdapter(store);
    this.collectionQueries = new CollectionQueryService(collectionQueries);
    const collectionWrites = new StoreBackedCollectionWriteAdapter(store);
    this.collectionRuns = new CollectionRunService(collectionWrites);
    this.runtimeLogs = new RuntimeLogService(collectionWrites, collectionQueries);
    this.taskScheduling = new TaskSchedulingService(collectionWrites, this.runtimeLogs);
    this.deviceLiveness = new DeviceLivenessService(collectionWrites, this.runtimeLogs);
  }

  async createRegistrationCode(expiresIn: AuthorizationExpiry): Promise<{ authorization: RegistrationCode; code: string }> {
    return this.deviceAuth.createRegistrationCode(expiresIn);
  }

  async listRegistrationCodes(page = 1, pageSize = DEFAULT_PAGE_SIZE): Promise<PageResult<RegistrationCode>> {
    return this.deviceAuth.listRegistrationCodes(page, pageSize);
  }

  async revokeRegistrationCode(authorizationId: string): Promise<RegistrationCode> {
    return this.deviceAuth.revokeRegistrationCode(authorizationId);
  }

  async registerDevelopmentDevice(input: { id?: string; name: string; extensionVersion: string }): Promise<Device> {
    return this.deviceAuth.registerDevelopmentDevice(input);
  }

  async authenticateDevelopmentDevice(deviceId: string): Promise<Device> {
    return this.deviceAuth.authenticateDevelopmentDevice(deviceId);
  }

  async registerDevice(input: { code: string; name: string; extensionVersion: string }): Promise<{ device: Device; tokens: TokenPair }> {
    return this.deviceAuth.registerDevice(input);
  }

  async refreshDeviceToken(refreshToken: string): Promise<TokenPair> {
    return this.deviceAuth.refreshDeviceToken(refreshToken);
  }

  async authenticate(accessToken: string): Promise<Device> {
    return this.deviceAuth.authenticate(accessToken);
  }

  async heartbeat(deviceId: string, input: { extensionVersion: string; queueDepth: number; taskId?: string }): Promise<Device & { taskCancelled?: boolean }> {
    return this.deviceLiveness.heartbeat(deviceId, input);
  }

  async createTask(input: { deviceId: string; type: TaskType; businessDate: string; idempotencyKey: string }): Promise<{ task: CollectionTask; created: boolean }> {
    return this.taskScheduling.createTask(input);
  }

  async createSchedule(input: { deviceId: string; type: TaskType; recurrence: ScheduleRecurrence; startAt: string; timeZone: string; idempotencyKey: string }): Promise<{ schedule: TaskSchedule; created: boolean }> {
    return this.taskScheduling.createSchedule(input);
  }

  async listSchedules(input: { deviceId?: string; status?: TaskSchedule["status"]; recurrence?: TaskSchedule["recurrence"]; page?: number; pageSize?: number }): Promise<PageResult<TaskSchedule>> {
    return this.collectionQueries.listSchedules(input);
  }

  async cancelSchedule(scheduleId: string): Promise<TaskSchedule> {
    return this.taskScheduling.cancelSchedule(scheduleId);
  }

  async claimNextTask(deviceId: string): Promise<CollectionTask | null> {
    return this.taskScheduling.claimNextTask(deviceId);
  }

  async updateTask(deviceId: string, taskId: string, input: { status: TaskStatus; runId?: string; errorCode?: string }): Promise<CollectionTask> {
    return this.taskScheduling.updateTask(deviceId, taskId, input);
  }

  async cancelTask(taskId: string): Promise<CollectionTask> {
    return this.taskScheduling.cancelTask(taskId);
  }

  async appendLog(input: { deviceId: string; taskId?: string; level: RuntimeLogLevel; event: string; message: string; metadata?: Record<string, string | number | boolean | null> }): Promise<RuntimeLog> {
    return this.runtimeLogs.appendLog(input);
  }

  async createRun(deviceId: string, input: { businessDate: string; sourceUrl: string; filters: Record<string, string>; idempotencyKey: string }): Promise<{ run: CollectionRun; created: boolean }> {
    return this.collectionRuns.createRun(deviceId, input);
  }

  async uploadItems(deviceId: string, runId: string, items: Array<Omit<ProjectSnapshot, "id" | "runId" | "normalizedProjectUrl" | "contentHash">>): Promise<{ accepted: number; duplicates: number }> {
    return this.collectionRuns.uploadItems(deviceId, runId, items);
  }

  async listRuns(date?: string, page = 1, pageSize = DEFAULT_PAGE_SIZE): Promise<PageResult<CollectionRun>> {
    return this.collectionQueries.listRuns(date, page, pageSize);
  }

  async listItems(runId: string, page = 1, pageSize = DEFAULT_PAGE_SIZE): Promise<PageResult<ProjectSnapshot>> {
    return this.collectionQueries.listItems(runId, page, pageSize);
  }

  async listDevices(page = 1, pageSize = DEFAULT_PAGE_SIZE): Promise<PageResult<Device>> {
    return this.collectionQueries.listDevices(page, pageSize);
  }

  async listTasks(input: { date?: string; deviceId?: string; status?: TaskStatus; page?: number; pageSize?: number }): Promise<PageResult<CollectionTask>> {
    return this.collectionQueries.listTasks(input);
  }

  async listLogs(input: { deviceId?: string; level?: RuntimeLogLevel; limit?: number; page?: number; pageSize?: number }): Promise<PageResult<RuntimeLog>> {
    return this.runtimeLogs.listLogs(input);
  }

  async revokeDevice(deviceId: string): Promise<Device> {
    return this.deviceAuth.revokeDevice(deviceId);
  }
}
