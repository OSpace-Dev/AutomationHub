import { createId } from "../shared/crypto.js";
import type { RuntimeLog, RuntimeLogLevel, StoreData } from "../domain/models.js";
import type { CollectionQueryPort } from "./ports/collection-query-port.js";
import type { CollectionWritePort } from "./ports/collection-write-port.js";
import { requireActiveDevice } from "./device-auth-service.js";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export interface RuntimeLogPageResult<T = RuntimeLog> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export class RuntimeLogService {
  constructor(private readonly writes: CollectionWritePort, private readonly queries: CollectionQueryPort) {}

  async appendLog(input: { deviceId: string; taskId?: string; level: RuntimeLogLevel; event: string; message: string; metadata?: Record<string, string | number | boolean | null> }): Promise<RuntimeLog> {
    return this.writes.update((data) => {
      requireActiveDevice(data, input.deviceId);
      return structuredClone(this.appendLogToData(data, input));
    });
  }

  async listLogs(input: { deviceId?: string; level?: RuntimeLogLevel; limit?: number; page?: number; pageSize?: number }): Promise<RuntimeLogPageResult> {
    const data = await this.queries.readSnapshot();
    return paginate(data.logs
      .filter((log) => (!input.deviceId || log.deviceId === input.deviceId) && (!input.level || log.level === input.level))
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)), input.page, input.pageSize ?? input.limit);
  }

  appendLogToData(data: StoreData, input: Omit<RuntimeLog, "id" | "occurredAt"> & { occurredAt?: string }): RuntimeLog {
    const log: RuntimeLog = { id: createId(), deviceId: input.deviceId, taskId: input.taskId, level: input.level, event: input.event, message: input.message, metadata: input.metadata, occurredAt: input.occurredAt ?? new Date().toISOString() };
    data.logs.push(log);
    return log;
  }
}

function paginate<T>(values: T[], requestedPage = 1, requestedPageSize = DEFAULT_PAGE_SIZE): RuntimeLogPageResult<T> {
  const pageSize = Math.min(Math.max(Number.isFinite(requestedPageSize) ? Math.trunc(requestedPageSize) : DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const total = values.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1, 1), totalPages);
  return { items: values.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize, totalPages };
}
