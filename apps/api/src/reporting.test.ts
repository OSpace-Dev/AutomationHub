import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { ApiKeyVault } from "./crypto.js";
import { ModelProviderService, OpenAiCompatibleClient } from "./model-service.js";
import { GitHubTrendingReportSource, ReportGenerationService } from "./report-service.js";
import { createApiServer } from "./server.js";
import { FileStore } from "./store.js";

let baseUrl = "";
let server: ReturnType<typeof createApiServer>;
let directory = "";
let deviceId = "";
let accessToken = "";
let runId = "";
let expectedModelUrl = "";
let chatResponseMode: "success" | "invalid-json" | "http-504-once" | "incomplete-once" | "incomplete-always" | "partial-fields-first" | "partial-fields-second" | "overlong-analysis" = "success";
let modelListResponseMode: "success" | "key-in-error" = "success";

const modelFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url.endsWith("/models")) {
    if (expectedModelUrl) assert.equal(url, expectedModelUrl);
    assert.equal((init?.headers as Record<string, string>).authorization, "Bearer sk-test-key");
    if (modelListResponseMode === "key-in-error") {
      return new Response(JSON.stringify({ error: { message: "Invalid API key sk-test-key" } }), { status: 401, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ data: [{ id: "daily-model", name: "Daily Model" }] }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.endsWith("/chat/completions")) {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "daily-model");
    assert.equal(body.stream, true);
    assert.equal(body.max_tokens, 2_400);
    assert.match(body.messages.at(-1).content, /Demo Project/);
    if (chatResponseMode === "invalid-json") return new Response("not-json", { status: 200, headers: { "content-type": "application/json" } });
    if (chatResponseMode === "http-504-once") {
      chatResponseMode = "success";
      return new Response(JSON.stringify({ error: { message: "upstream gateway timeout" } }), { status: 504, headers: { "content-type": "application/json" } });
    }
    if (chatResponseMode === "incomplete-once" || chatResponseMode === "incomplete-always") {
      if (chatResponseMode === "incomplete-once") chatResponseMode = "success";
      return createStreamResponse(JSON.stringify({ project_analyses: [] }));
    }
    if (chatResponseMode === "partial-fields-first") {
      chatResponseMode = "partial-fields-second";
      return createStreamResponse(JSON.stringify({
        project_analyses: [{
          project_url: "acme/demo",
          category: "developer-tools",
          purpose: "第一次响应提供用途说明。"
        }]
      }));
    }
    if (chatResponseMode === "partial-fields-second") {
      chatResponseMode = "success";
      return createStreamResponse(JSON.stringify({
        project_analyses: [{
          repository: "https://www.github.com/acme/demo/",
          category: "开发者工具",
          attentionReason: "第二次响应补充值得关注原因。"
        }]
      }));
    }
    if (chatResponseMode === "overlong-analysis") {
      chatResponseMode = "success";
      return createStreamResponse(JSON.stringify({
        project_analyses: [{
          project_url: "github.com/acme/demo",
          category: "开发者工具",
          purpose: "用于统一研发团队的开发、验证与交付流程，减少分散脚本和手工衔接造成的重复工作。该项目还支持将常用步骤沉淀为可复用能力。",
          attention_reason: "适合需要稳定工程协作流程的小团队或平台团队，用于把高频操作转为可维护工具链，降低新人接入和日常维护成本，并提升交付过程的可追踪性。"
        }]
      }));
    }
    return createStreamResponse(JSON.stringify({
      project_analyses: [{
        project_url: "github.com/acme/demo",
        category: "开发者工具",
        purpose: "面向研发团队的可组合工作流工具，用于把开发、验证与交付步骤统一起来。",
        attention_reason: "适合需要沉淀工程流程的小团队，将重复操作变为可复用链路，降低协作与维护成本。"
      }]
    }));
  }
  return new Response(JSON.stringify({ error: { message: "unknown endpoint" } }), { status: 404, headers: { "content-type": "application/json" } });
};

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "automation-hub-reporting-"));
  const store = new FileStore(join(directory, "store.json"));
  await store.initialize();
  server = createApiServer({
    store,
    authEnabled: false,
    corsOrigin: "*",
    modelEncryptionKey: "stable-test-encryption-key",
    publicBaseUrl: "https://reports.example.test",
    modelFetch,
    modelRequestMinIntervalMs: 0
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;

  const registered = await request("/api/v1/devices/register", { method: "POST", body: JSON.stringify({ name: "report-node", extension_version: "1.0.0" }) });
  deviceId = registered.body.data.device.id;
  accessToken = "";
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await rm(directory, { recursive: true, force: true });
});

async function request(path: string, init: RequestInit = {}): Promise<{ response: Response; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
  return { response, body: await response.json() };
}

function createStreamResponse(content: string): Response {
  const encoder = new TextEncoder();
  const splitAt = Math.max(1, Math.floor(content.length / 2));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of [content.slice(0, splitAt), content.slice(splitAt)]) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    }
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

test("splits project context into bounded batches and filters GitHub loading placeholders", () => {
  const source = new GitHubTrendingReportSource();
  const createdAt = "2026-08-16T00:00:00.000Z";
  const run = {
    id: "batch-run",
    deviceId: "batch-device",
    businessDate: "2026-08-16",
    sourceUrl: "https://github.com/trending",
    filters: {},
    idempotencyKey: "batch-run",
    status: "completed" as const,
    itemCount: 7,
    successCount: 7,
    failureCount: 0,
    createdAt
  };
  const items = Array.from({ length: 7 }, (_, index) => {
    const projectNumber = index + 1;
    const placeholder = projectNumber === 7
      ? `GitHub project page There was an error while loading. Please reload this page. ${"error ".repeat(120)}`
      : undefined;
    return {
      id: `item-${projectNumber}`,
      runId: run.id,
      projectUrl: `https://github.com/acme/project-${projectNumber}`,
      normalizedProjectUrl: `https://github.com/acme/project-${projectNumber}`,
      rank: projectNumber,
      name: projectNumber === 1 ? "Demo Project" : `Project ${projectNumber}`,
      description: placeholder ?? `Description ${projectNumber}`,
      language: "TypeScript",
      totalStars: 100 + projectNumber,
      starsToday: projectNumber,
      readmeHtml: "",
      readmeText: placeholder ?? `README ${projectNumber}`,
      contentHash: `hash-${projectNumber}`,
      readAt: createdAt,
      status: "success" as const
    };
  });
  const definition = {
    id: "definition",
    type: "daily_report",
    name: "GitHub Trending 日报",
    sourceType: "github_trending" as const,
    promptTemplate: "Analyze the supplied projects.",
    enabled: true,
    createdAt,
    updatedAt: createdAt
  };
  const batches = source.prepareBatches({ run, items, previousItems: [] }, definition);
  assert.deepEqual(batches.map((batch) => batch.itemCount), [4, 3]);
  assert.equal(batches.flatMap((batch) => batch.projectUrls).length, 7);
  const promptText = batches.flatMap((batch) => batch.messages).map((message) => message.content).join("\n");
  const projectDataText = batches.map((batch) => batch.messages.at(-1)?.content ?? "").join("\n");
  assert.doesNotMatch(promptText, /There was an error while loading/i);
  assert.doesNotMatch(projectDataText, /今日新增 Star|总 Star|排名：/);
  assert.match(promptText, /Project 7/);
  assert.match(promptText, /两项合并后约 50 至 100 个中文字符/);
});

test("generates and merges every project across streamed batches", async () => {
  const batchDirectory = await mkdtemp(join(tmpdir(), "automation-hub-report-batches-"));
  const batchStore = new FileStore(join(batchDirectory, "store.json"));
  await batchStore.initialize();
  const prompts: string[] = [];
  const promptAttempts = new Map<string, number>();
  const batchFetch: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.stream, true);
    const prompt = String(body.messages.at(-1).content);
    prompts.push(prompt);
    const attempt = (promptAttempts.get(prompt) ?? 0) + 1;
    promptAttempts.set(prompt, attempt);
    const projectUrls = [...prompt.matchAll(/^地址：(https:\/\/github\.com\/\S+)$/gm)].map((match) => match[1]);
    const analyses = projectUrls.filter((_projectUrl, index) => index % 2 === attempt - 1).map((projectUrl) => {
      const name = projectUrl.split("/").pop();
      return {
        project_url: projectUrl,
        category: "开发者工具",
        purpose: `${name} 用于组织可复用的开发工作流。`,
        attention_reason: `${name} 将常见开发步骤整合为清晰的工具链。`
      };
    });
    return createStreamResponse(JSON.stringify({ project_analyses: analyses }));
  };
  const providers = new ModelProviderService(
    batchStore,
    new ApiKeyVault("batch-test-encryption-key"),
    new OpenAiCompatibleClient(batchFetch)
  );
  let now = 0;
  const waits: number[] = [];
  const reports = new ReportGenerationService(batchStore, providers, {
    modelRequestMinIntervalMs: 60_000,
    now: () => now,
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
      now += milliseconds;
    }
  });
  const createdAt = "2026-08-16T00:00:00.000Z";
  try {
    await providers.create({
      name: "Batch Model",
      baseUrl: "http://batch-model.test/v1",
      apiKey: "sk-batch-test",
      selectedModel: "daily-model",
      isDefault: true
    });
    await batchStore.update((data) => {
      data.runs.push({
        id: "batch-generation-run",
        deviceId: "batch-device",
        businessDate: "2026-08-16",
        sourceUrl: "https://github.com/trending",
        filters: {},
        idempotencyKey: "batch-generation-run",
        status: "completed",
        itemCount: 7,
        successCount: 7,
        failureCount: 0,
        createdAt
      });
      data.items.push(...Array.from({ length: 8 }, (_, index) => {
        const projectNumber = index + 1;
        const projectUrl = `https://github.com/acme/project-${projectNumber}`;
        const placeholder = projectNumber === 8 ? "There was an error while loading. Please reload this page." : undefined;
        return {
          id: `batch-item-${projectNumber}`,
          runId: "batch-generation-run",
          projectUrl,
          normalizedProjectUrl: projectUrl,
          rank: projectNumber,
          name: `Project ${projectNumber}`,
          description: placeholder ?? `Developer workflow project ${projectNumber}`,
          language: "TypeScript",
          totalStars: 1_000 + projectNumber,
          starsToday: 10 + projectNumber,
          readmeHtml: "",
          readmeText: placeholder ?? `Project ${projectNumber} README`,
          contentHash: `batch-hash-${projectNumber}`,
          readAt: createdAt,
          status: "success" as const
        };
      }));
    });
    await reports.start();
    const generation = await reports.createManual("batch-generation-run");
    const completed = await waitForStoredReport(batchStore, generation.id, "completed");
    assert.equal(prompts.length, 4);
    assert.deepEqual(waits, [60_000, 60_000, 60_000]);
    assert.equal(prompts[0], prompts[1]);
    assert.equal(prompts[2], prompts[3]);
    assert.notEqual(prompts[0], prompts[2]);
    assert.deepEqual(prompts.map((prompt) => [...prompt.matchAll(/^地址：/gm)].length), [4, 4, 4, 4]);
    assert.equal(prompts.some((prompt) => /There was an error while loading/i.test(prompt)), false);
    assert.equal(completed.inputItemCount, 8);
    assert.equal(completed.insights.categories.flatMap((category: any) => category.projects).length, 8);
    assert.equal(completed.insights.categories.find((category: any) => category.label === "开发者工具").projects.length, 7);
    const incompleteProject = completed.insights.categories.find((category: any) => category.label === "其他").projects[0];
    assert.equal(incompleteProject.purpose, "暂无可靠项目说明。");
    assert.match(incompleteProject.attentionReason, /采集内容不足/);
    assert.equal(JSON.stringify(completed.insights).includes("There was an error while loading"), false);
  } finally {
    reports.stop();
    await rm(batchDirectory, { recursive: true, force: true });
  }
});

test("configures an encrypted model provider without returning its key", async () => {
  const created = await request("/api/v1/admin/model-providers", {
    method: "POST",
    body: JSON.stringify({ name: "Test Model", base_url: "http://model.test/v1", api_key: "sk-test-key", selected_model: "daily-model", is_default: true })
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.data.api_key_configured, true);
  assert.equal(created.body.data.api_key_hint, "••••-key");
  assert.equal("encrypted_api_key" in created.body.data, false);

  const listed = await request("/api/v1/admin/model-providers");
  assert.equal(listed.body.data[0].api_key_hint, "••••-key");
  assert.equal(JSON.stringify(listed.body), JSON.stringify(listed.body).replace("sk-test-key", "redacted"));

  const models = await request("/api/v1/admin/model-providers/models:fetch", {
    method: "POST",
    body: JSON.stringify({ provider_id: created.body.data.id })
  });
  assert.equal(models.response.status, 200);
  assert.equal(models.body.data[0].id, "daily-model");

  expectedModelUrl = "http://model-override.test/v1/models";
  const overriddenModels = await request("/api/v1/admin/model-providers/models:fetch", {
    method: "POST",
    body: JSON.stringify({ provider_id: created.body.data.id, base_url: "http://model-override.test/v1" })
  });
  expectedModelUrl = "";
  assert.equal(overriddenModels.response.status, 200);

  modelListResponseMode = "key-in-error";
  const failedModels = await request("/api/v1/admin/model-providers/models:fetch", {
    method: "POST",
    body: JSON.stringify({ provider_id: created.body.data.id })
  });
  modelListResponseMode = "success";
  assert.equal(failedModels.response.status, 502);
  assert.equal(JSON.stringify(failedModels.body).includes("sk-test-key"), false);
  const afterFailure = await request("/api/v1/admin/model-providers");
  assert.equal(afterFailure.body.data[0].last_error.includes("sk-test-key"), false);
  assert.match(afterFailure.body.data[0].last_error, /\[redacted\]/);

  const storeContent = await readFile(join(directory, "store.json"), "utf8");
  assert.equal(storeContent.includes("sk-test-key"), false);
});

test("automatically generates a report after task completion and supports manual retry", async () => {
  const run = await request("/api/v1/collection-runs", {
    method: "POST",
    headers: { "x-device-id": deviceId, "idempotency-key": "report-run-1" },
    body: JSON.stringify({ business_date: "2026-08-16", source_url: "https://github.com/trending", filters: {} })
  });
  runId = run.body.data.id;
  const uploaded = await request(`/api/v1/collection-runs/${runId}/items:batch`, {
    method: "POST",
    headers: { "x-device-id": deviceId },
    body: JSON.stringify({ items: [{ project_url: "https://github.com/acme/demo", rank: 1, name: "Demo Project", description: "Developer workflow toolkit", language: "TypeScript", total_stars: 100, stars_today: 12, readme_html: "<h1>Demo</h1>", readme_text: "Demo project README", read_at: "2026-08-16T00:00:00.000Z", status: "success" }] })
  });
  assert.equal(uploaded.response.status, 200);

  const task = await request("/api/v1/admin/tasks", {
    method: "POST",
    headers: { "idempotency-key": "report-task-1" },
    body: JSON.stringify({ device_id: deviceId, type: "capture_trending", business_date: "2026-08-16" })
  });
  const claim = await request("/api/v1/devices/tasks:claim", { method: "POST", headers: { "x-device-id": deviceId } });
  assert.equal(claim.body.data.task.id, task.body.data.id);

  const missingRunCompletion = await request(`/api/v1/devices/tasks/${task.body.data.id}:status`, {
    method: "POST",
    headers: { "x-device-id": deviceId },
    body: JSON.stringify({ status: "completed" })
  });
  assert.equal(missingRunCompletion.response.status, 400);
  assert.equal(missingRunCompletion.body.code, "invalid_payload");

  const otherDevice = await request("/api/v1/devices/register", {
    method: "POST",
    body: JSON.stringify({ name: "other-report-node", extension_version: "1.0.0" })
  });
  const foreignRun = await request("/api/v1/collection-runs", {
    method: "POST",
    headers: { "x-device-id": otherDevice.body.data.device.id, "idempotency-key": "foreign-report-run" },
    body: JSON.stringify({ business_date: "2026-08-16", source_url: "https://github.com/trending", filters: {} })
  });
  const foreignCompletion = await request(`/api/v1/devices/tasks/${task.body.data.id}:status`, {
    method: "POST",
    headers: { "x-device-id": deviceId },
    body: JSON.stringify({ status: "completed", run_id: foreignRun.body.data.id })
  });
  assert.equal(foreignCompletion.response.status, 404);
  assert.equal(foreignCompletion.body.code, "run_not_found");

  const wrongDateRun = await request("/api/v1/collection-runs", {
    method: "POST",
    headers: { "x-device-id": deviceId, "idempotency-key": "wrong-date-report-run" },
    body: JSON.stringify({ business_date: "2026-08-15", source_url: "https://github.com/trending", filters: {} })
  });
  const wrongDateCompletion = await request(`/api/v1/devices/tasks/${task.body.data.id}:status`, {
    method: "POST",
    headers: { "x-device-id": deviceId },
    body: JSON.stringify({ status: "completed", run_id: wrongDateRun.body.data.id })
  });
  assert.equal(wrongDateCompletion.response.status, 409);
  assert.equal(wrongDateCompletion.body.code, "task_run_mismatch");
  const previousUploaded = await request(`/api/v1/collection-runs/${wrongDateRun.body.data.id}/items:batch`, {
    method: "POST",
    headers: { "x-device-id": deviceId },
    body: JSON.stringify({ items: [{ project_url: "https://github.com/acme/demo", rank: 3, name: "Demo Project", description: "Developer workflow toolkit", language: "TypeScript", total_stars: 90, stars_today: 7, readme_html: "<h1>Demo</h1>", readme_text: "Previous README", read_at: "2026-08-15T00:00:00.000Z", status: "success" }] })
  });
  assert.equal(previousUploaded.response.status, 200);

  const completed = await request(`/api/v1/devices/tasks/${task.body.data.id}:status`, {
    method: "POST",
    headers: { "x-device-id": deviceId },
    body: JSON.stringify({ status: "completed", run_id: runId })
  });
  assert.equal(completed.response.status, 200);

  const automatic = await waitForReport((entry) => entry.trigger === "automatic" && entry.status === "completed");
  assert.match(automatic.content, /今天共收录/);
  assert.equal(automatic.insights.metrics.project_count, 1);
  assert.equal(automatic.insights.metrics.total_stars, 100);
  assert.equal(automatic.insights.metrics.stars_today, 12);
  assert.equal(automatic.insights.metrics.total_stars_delta, 10);
  assert.equal(automatic.insights.metrics.analysis_fallback_count, 0);
  assert.equal(automatic.insights.presentation_version, 2);
  assert.match(automatic.insights.overview, /开发者工具/);
  assert.equal(automatic.insights.categories[0].label, "开发者工具");
  const automaticProject = automatic.insights.categories[0].projects[0];
  assert.match(automaticProject.purpose, /可组合工作流/);
  assert.match(automaticProject.attention_reason, /沉淀工程流程/);
  assert.ok((automaticProject.purpose.length + automaticProject.attention_reason.length) >= 50);
  assert.ok((automaticProject.purpose.length + automaticProject.attention_reason.length) <= 100);
  assert.equal(automatic.insights.trends.comparison_date, "2026-08-15");
  assert.equal(automatic.insights.trends.rising_entries[0].rank_change, 2);
  assert.match(automatic.public_url, /^https:\/\/reports\.example\.test\/share\/reports\/[A-Za-z0-9_-]+$/);
  const publicToken = automatic.public_url.split("/").pop();
  const publicReport = await request(`/api/v1/public/reports/${publicToken}`);
  assert.equal(publicReport.response.status, 200);
  assert.equal(publicReport.body.data.business_date, "2026-08-16");
  assert.equal(publicReport.body.data.content, automatic.content);
  assert.equal(publicReport.body.data.insights.metrics.stars_today, 12);
  assert.equal(publicReport.body.data.insights.categories[0].projects[0].purpose, automatic.insights.categories[0].projects[0].purpose);
  assert.equal("run_id" in publicReport.body.data, false);
  const missingPublicReport = await request("/api/v1/public/reports/not-a-real-token");
  assert.equal(missingPublicReport.response.status, 404);

  const manual = await request("/api/v1/admin/reports", { method: "POST", body: JSON.stringify({ run_id: runId }) });
  assert.equal(manual.response.status, 202);
  const manualCompleted = await waitForReport((entry) => entry.id === manual.body.data.id && entry.status === "completed");
  assert.equal(manualCompleted.trigger, "manual");

  const retry = await request(`/api/v1/admin/reports/${automatic.id}:retry`, { method: "POST" });
  assert.equal(retry.response.status, 202);
  const retried = await waitForReport((entry) => entry.id === retry.body.data.id && entry.status === "completed");
  assert.equal(retried.trigger, "retry");

  const listed = await request("/api/v1/admin/reports?date=2026-08-16&page=1&page_size=2");
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.meta.total, 3);
  assert.equal(listed.body.data.length, 2);
  assert.equal("content" in listed.body.data[0], false);

  chatResponseMode = "invalid-json";
  const invalidResponse = await request("/api/v1/admin/reports", { method: "POST", body: JSON.stringify({ run_id: runId }) });
  const invalidReport = await waitForReport((entry) => entry.id === invalidResponse.body.data.id && entry.status === "failed");
  chatResponseMode = "success";
  assert.equal(invalidReport.error_code, "report_generation_failed");
  assert.equal(invalidReport.provider_name, "Test Model");
  assert.equal(invalidReport.model, "daily-model");
  assert.equal(invalidReport.input_item_count, 1);

  chatResponseMode = "http-504-once";
  const transientFailure = await request("/api/v1/admin/reports", { method: "POST", body: JSON.stringify({ run_id: runId }) });
  const recoveredReport = await waitForReport((entry) => entry.id === transientFailure.body.data.id && entry.status === "completed");
  assert.equal(recoveredReport.error_code, undefined);

  chatResponseMode = "incomplete-once";
  const incompleteBatch = await request("/api/v1/admin/reports", { method: "POST", body: JSON.stringify({ run_id: runId }) });
  const completedAfterIncompleteBatch = await waitForReport((entry) => entry.id === incompleteBatch.body.data.id && entry.status === "completed");
  assert.equal(completedAfterIncompleteBatch.error_code, undefined);

  chatResponseMode = "partial-fields-first";
  const partialFieldsBatch = await request("/api/v1/admin/reports", { method: "POST", body: JSON.stringify({ run_id: runId }) });
  const completedAfterFieldMerge = await waitForReport((entry) => entry.id === partialFieldsBatch.body.data.id && entry.status === "completed");
  assert.equal(completedAfterFieldMerge.insights.metrics.analysis_fallback_count, 0);
  assert.equal(completedAfterFieldMerge.insights.categories[0].projects[0].purpose, "第一次响应提供用途说明。");
  assert.equal(completedAfterFieldMerge.insights.categories[0].projects[0].attention_reason, "第二次响应补充值得关注原因。");

  chatResponseMode = "overlong-analysis";
  const overlongBatch = await request("/api/v1/admin/reports", { method: "POST", body: JSON.stringify({ run_id: runId }) });
  const completedWithBoundedSummary = await waitForReport((entry) => entry.id === overlongBatch.body.data.id && entry.status === "completed");
  const boundedProject = completedWithBoundedSummary.insights.categories[0].projects[0];
  assert.equal(boundedProject.purpose.length, 45);
  assert.equal(boundedProject.attention_reason.length, 55);
  assert.equal(boundedProject.purpose.length + boundedProject.attention_reason.length, 100);

  chatResponseMode = "incomplete-always";
  const degradedBatch = await request("/api/v1/admin/reports", { method: "POST", body: JSON.stringify({ run_id: runId }) });
  const completedWithFallback = await waitForReport((entry) => entry.id === degradedBatch.body.data.id && entry.status === "completed");
  chatResponseMode = "success";
  assert.equal(completedWithFallback.insights.metrics.analysis_fallback_count, 1);
  assert.match(completedWithFallback.insights.categories[0].projects[0].attention_reason, /自动分析未完整返回/);
  assert.ok((completedWithFallback.insights.categories[0].projects[0].purpose.length + completedWithFallback.insights.categories[0].projects[0].attention_reason.length) <= 100);
});

test("recovers every interrupted running report when the worker restarts", async () => {
  const recoveryDirectory = await mkdtemp(join(tmpdir(), "automation-hub-report-recovery-"));
  const recoveryStore = new FileStore(join(recoveryDirectory, "store.json"));
  await recoveryStore.initialize();
  await recoveryStore.update((data) => {
    data.reportGenerations.push({
      id: "interrupted-report",
      definitionId: "missing-definition",
      sourceType: "github_trending",
      businessDate: "2026-08-16",
      runId: "missing-run",
      trigger: "automatic",
      status: "running",
      inputItemCount: 0,
      attemptCount: 1,
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString()
    });
  });
  const recoveryProviders = new ModelProviderService(
    recoveryStore,
    new ApiKeyVault("recovery-test-encryption-key"),
    new OpenAiCompatibleClient(modelFetch)
  );
  const recoveryReports = new ReportGenerationService(recoveryStore, recoveryProviders, { modelRequestMinIntervalMs: 0 });
  try {
    await recoveryReports.start();
    const recovered = await waitForStoredReport(recoveryStore, "interrupted-report", "failed");
    assert.equal(recovered.attemptCount, 2);
    assert.equal(recovered.errorCode, "default_model_provider_missing");
  } finally {
    recoveryReports.stop();
    await rm(recoveryDirectory, { recursive: true, force: true });
  }
});

async function waitForReport(predicate: (entry: any) => boolean): Promise<any> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const response = await request("/api/v1/admin/reports?date=2026-08-16&page=1&page_size=100");
    const found = response.body.data.find(predicate);
    if (found) {
      const detail = await request(`/api/v1/admin/reports/${found.id}`);
      return detail.body.data;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for report generation");
}

async function waitForStoredReport(store: FileStore, id: string, status: string): Promise<any> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const data = await store.read();
    const found = data.reportGenerations.find((entry) => entry.id === id && entry.status === status);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for stored report ${id} to reach ${status}`);
}
