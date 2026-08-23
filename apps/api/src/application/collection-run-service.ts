import { createId, hashContent } from "../shared/crypto.js";
import { ApiError, invalidPayload } from "../shared/errors.js";
import type { CollectionRun, ProjectSnapshot, StoreData } from "../domain/models.js";
import type { CollectionWritePort } from "./ports/collection-write-port.js";
import { requireActiveDevice } from "./device-auth-service.js";

export class CollectionRunService {
  constructor(private readonly writes: CollectionWritePort) {}

  async createRun(deviceId: string, input: { businessDate: string; sourceUrl: string; filters: Record<string, string>; idempotencyKey: string }): Promise<{ run: CollectionRun; created: boolean }> {
    return this.writes.update((data) => {
      requireActiveDevice(data, deviceId);
      const existing = data.runs.find((run) => run.deviceId === deviceId && run.idempotencyKey === input.idempotencyKey);
      if (existing) return { run: structuredClone(existing), created: false };

      const run: CollectionRun = {
        id: createId(),
        deviceId,
        businessDate: input.businessDate,
        sourceUrl: input.sourceUrl,
        filters: input.filters,
        idempotencyKey: input.idempotencyKey,
        status: "running",
        itemCount: 0,
        successCount: 0,
        failureCount: 0,
        createdAt: new Date().toISOString()
      };
      data.runs.push(run);
      return { run: structuredClone(run), created: true };
    });
  }

  async uploadItems(deviceId: string, runId: string, items: Array<Omit<ProjectSnapshot, "id" | "runId" | "normalizedProjectUrl" | "contentHash">>): Promise<{ accepted: number; duplicates: number }> {
    return this.writes.update((data) => {
      const run = data.runs.find((entry) => entry.id === runId && entry.deviceId === deviceId);
      if (!run) throw new ApiError(404, "run_not_found", "Collection run was not found", true);

      let accepted = 0;
      let duplicates = 0;
      for (const input of items) {
        const normalizedProjectUrl = normalizeProjectUrl(input.projectUrl);
        if (data.items.some((item) => item.runId === runId && item.normalizedProjectUrl === normalizedProjectUrl)) {
          duplicates += 1;
          continue;
        }
        const snapshot: ProjectSnapshot = {
          ...input,
          id: createId(),
          runId,
          normalizedProjectUrl,
          contentHash: hashContent(`${input.readmeHtml}\n${input.readmeText}`)
        };
        data.items.push(snapshot);
        accepted += 1;
      }
      updateRunCounts(data, run);
      return { accepted, duplicates };
    });
  }
}

function updateRunCounts(data: StoreData, run: CollectionRun): void {
  const items = data.items.filter((item) => item.runId === run.id);
  run.itemCount = items.length;
  run.successCount = items.filter((item) => item.status === "success").length;
  run.failureCount = items.filter((item) => item.status === "failed").length;
  run.status = run.failureCount === 0 ? "completed" : "partial";
}

function normalizeProjectUrl(projectUrl: string): string {
  let url: URL;
  try {
    url = new URL(projectUrl);
  } catch {
    throw invalidPayload("project_url must be a valid URL");
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com") {
    throw invalidPayload("project_url must be an HTTPS github.com URL");
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 2) throw invalidPayload("project_url must identify a GitHub repository");
  return `https://github.com/${segments[0].toLowerCase()}/${segments[1].toLowerCase()}`;
}
