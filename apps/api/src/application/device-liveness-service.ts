import type { Device, StoreData } from "../models.js";
import type { Store } from "../store.js";
import { DeviceAuthService } from "./device-auth-service.js";
import { RuntimeLogService } from "./runtime-log-service.js";

export class DeviceLivenessService {
  private readonly deviceAuth: DeviceAuthService;

  constructor(private readonly store: Store, private readonly runtimeLogs: RuntimeLogService) {
    this.deviceAuth = new DeviceAuthService(store);
  }

  async heartbeat(deviceId: string, input: { extensionVersion: string; queueDepth: number; taskId?: string }): Promise<Device & { taskCancelled?: boolean }> {
    return this.store.update((data) => {
      const device = this.deviceAuth.requireActiveDevice(data, deviceId);
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
      this.runtimeLogs.appendLogToData(data, {
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
}
