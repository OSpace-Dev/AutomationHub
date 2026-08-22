import type { CollectionRun, CollectionTask, Device, ProjectSnapshot, TaskSchedule } from "../../models.js";

export interface CollectionQuerySnapshot {
  readonly runs: readonly CollectionRun[];
  readonly items: readonly ProjectSnapshot[];
  readonly devices: readonly Device[];
  readonly tasks: readonly CollectionTask[];
  readonly schedules: readonly TaskSchedule[];
}

export interface CollectionQueryPort {
  readSnapshot(): Promise<CollectionQuerySnapshot>;
}
