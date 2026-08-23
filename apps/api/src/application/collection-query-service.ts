import { ApiError } from "../shared/errors.js";
import type { CollectionRun, CollectionTask, Device, ProjectSnapshot, ScheduleRecurrence, TaskSchedule, TaskStatus } from "../domain/models.js";
import type { CollectionQueryPort } from "./ports/collection-query-port.js";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export class CollectionQueryService {
  constructor(private readonly queries: CollectionQueryPort) {}

  async listSchedules(input: { deviceId?: string; status?: TaskSchedule["status"]; recurrence?: ScheduleRecurrence; page?: number; pageSize?: number }): Promise<PageResult<TaskSchedule>> {
    const data = await this.queries.readSnapshot();
    return paginate([...data.schedules]
      .filter((schedule) => (!input.deviceId || schedule.deviceId === input.deviceId)
        && (!input.status || schedule.status === input.status)
        && (!input.recurrence || schedule.recurrence === input.recurrence))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)), input.page, input.pageSize);
  }

  async listRuns(date?: string, page = 1, pageSize = DEFAULT_PAGE_SIZE): Promise<PageResult<CollectionRun>> {
    const data = await this.queries.readSnapshot();
    return paginate([...data.runs].filter((run) => !date || run.businessDate === date).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), page, pageSize);
  }

  async listItems(runId: string, page = 1, pageSize = DEFAULT_PAGE_SIZE): Promise<PageResult<ProjectSnapshot>> {
    const data = await this.queries.readSnapshot();
    if (!data.runs.some((run) => run.id === runId)) throw new ApiError(404, "run_not_found", "Collection run was not found");
    return paginate([...data.items].filter((item) => item.runId === runId).sort((a, b) => a.rank - b.rank), page, pageSize);
  }

  async listDevices(page = 1, pageSize = DEFAULT_PAGE_SIZE): Promise<PageResult<Device>> {
    const data = await this.queries.readSnapshot();
    return paginate([...data.devices].sort((a, b) => b.registeredAt.localeCompare(a.registeredAt)), page, pageSize);
  }

  async listTasks(input: { date?: string; deviceId?: string; status?: TaskStatus; page?: number; pageSize?: number }): Promise<PageResult<CollectionTask>> {
    const data = await this.queries.readSnapshot();
    return paginate([...data.tasks]
      .filter((task) => (!input.date || task.businessDate === input.date) && (!input.deviceId || task.deviceId === input.deviceId) && (!input.status || task.status === input.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)), input.page, input.pageSize);
  }

}

function paginate<T>(values: T[], requestedPage = 1, requestedPageSize = DEFAULT_PAGE_SIZE): PageResult<T> {
  const pageSize = Math.min(Math.max(Number.isFinite(requestedPageSize) ? Math.trunc(requestedPageSize) : DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const total = values.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1, 1), totalPages);
  return { items: values.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize, totalPages };
}
