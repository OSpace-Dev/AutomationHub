import type { Device, StoreData } from "../domain/models.js";
import type { CollectionWritePort } from "./ports/collection-write-port.js";
import { requireActiveDevice } from "./device-auth-service.js";
import { RuntimeLogService } from "./runtime-log-service.js";

export class DeviceLivenessService {
  constructor(private readonly writes: CollectionWritePort, private readonly runtimeLogs: RuntimeLogService) {}

  async heartbeat(deviceId: string, input: { extensionVersion: string; queueDepth: number; taskId?: string }): Promise<Device & { taskCancelled?: boolean }> {
    return this.writes.update((data) => {
      const device = requireActiveDevice(data, deviceId);
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
