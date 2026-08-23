import type { CollectionRun, CollectionTask, Device, ProjectSnapshot, RuntimeLog, TaskSchedule } from "../../domain/models.js";

export interface CollectionQuerySnapshot {
  readonly runs: readonly CollectionRun[];
  readonly items: readonly ProjectSnapshot[];
  readonly devices: readonly Device[];
  readonly tasks: readonly CollectionTask[];
  readonly schedules: readonly TaskSchedule[];
  readonly logs: readonly RuntimeLog[];
}

export interface CollectionQueryPort {
  readSnapshot(): Promise<CollectionQuerySnapshot>;
}
