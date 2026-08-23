import type {
  NotificationPersistenceData,
  NotificationPersistencePort
} from "../../application/ports/notification-persistence-port.js";
import type { Store } from "../../application/ports/store.js";
import type { StoreData } from "../../domain/models.js";

export class StoreBackedNotificationPersistenceAdapter implements NotificationPersistencePort {
  constructor(private readonly store: Store) {}

  async readSnapshot(): Promise<NotificationPersistenceData> {
    const data = await this.store.read();
    return selectNotificationData(data);
  }

  update<T>(mutation: (data: NotificationPersistenceData) => T): Promise<T> {
    return this.store.update((data) => mutation(selectNotificationData(data)));
  }
}

function selectNotificationData(data: StoreData): NotificationPersistenceData {
  return {
    reportGenerations: data.reportGenerations,
    notificationChannels: data.notificationChannels,
    notificationTargets: data.notificationTargets,
    reportDeliveries: data.reportDeliveries
  };
}
