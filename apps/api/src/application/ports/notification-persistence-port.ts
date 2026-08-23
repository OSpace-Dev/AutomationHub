import type { StoreData } from "../../domain/models.js";

export type NotificationPersistenceData = Pick<
  StoreData,
  "reportGenerations" | "notificationChannels" | "notificationTargets" | "reportDeliveries"
>;

export interface NotificationPersistencePort {
  readSnapshot(): Promise<NotificationPersistenceData>;
  update<T>(mutation: (data: NotificationPersistenceData) => T): Promise<T>;
}
