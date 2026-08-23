import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createApiServer } from "../http/server.js";
import { FileStore } from "../infrastructure/persistence/file-store.js";
import { parseAuthEnabled } from "../main/config.js";

let baseUrl = "";
let registrationCode = "test-registration-code";
let accessToken = "";
let deviceId = "";
let runId = "";
let server: ReturnType<typeof createApiServer>;
let temporaryDirectory = "";

test("derives authentication from the admin key and rejects invalid values", () => {
  assert.equal(parseAuthEnabled(undefined, undefined), false);
  assert.equal(parseAuthEnabled(undefined, "admin-key"), true);
  assert.equal(parseAuthEnabled("", "admin-key"), true);
  assert.equal(parseAuthEnabled("true", undefined), true);
  assert.equal(parseAuthEnabled("false", "admin-key"), false);
  assert.throws(() => parseAuthEnabled("TRUE", undefined), /AUTH_ENABLED must be true or false/);
  assert.throws(() => parseAuthEnabled("yes", undefined), /AUTH_ENABLED must be true or false/);
});

before(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "automation-hub-"));
  const store = new FileStore(join(temporaryDirectory, "store.json"));
  await store.initialize(registrationCode);
  server = createApiServer({ store, adminApiKey: "admin-test-key", authEnabled: true, corsOrigin: "http://localhost:5173" });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await rm(temporaryDirectory, { recursive: true, force: true });
});

async function request(path: string, init: RequestInit = {}): Promise<{ response: Response; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) }
  });
  return { response, body: await response.json() };
}

test("exposes authentication status without exposing the admin key", async () => {
  const status = await request("/api/v1/admin/auth-status");
  assert.equal(status.response.status, 200);
  assert.deepEqual(status.body.data, { auth_enabled: true, key_configured: true });
  assert.doesNotMatch(JSON.stringify(status.body), /admin-test-key/);

  const unauthenticated = await request("/api/v1/admin/session");
  assert.equal(unauthenticated.response.status, 403);
  assert.equal(unauthenticated.body.code, "admin_forbidden");

  const authenticated = await request("/api/v1/admin/session", { headers: { "x-admin-key": "admin-test-key" } });
  assert.equal(authenticated.response.status, 200);
  assert.deepEqual(authenticated.body.data, { authenticated: true });
});

test("registers a device and enforces one-time registration", async () => {
  const registered = await request("/api/v1/devices/register", {
    method: "POST",
    body: JSON.stringify({ registration_code: registrationCode, name: "test-node", extension_version: "0.1.0" })
  });
  assert.equal(registered.response.status, 201);
  accessToken = registered.body.data.access_token;
  deviceId = registered.body.data.device.id;
  assert.ok(accessToken);

  const reused = await request("/api/v1/devices/register", {
    method: "POST",
    body: JSON.stringify({ registration_code: registrationCode, name: "second-node", extension_version: "0.1.0" })
  });
  assert.equal(reused.response.status, 401);
  assert.equal(reused.body.code, "invalid_registration_code");
});

test("manages one-time authorizations and revokes the linked device", async () => {
  const created = await request("/api/v1/admin/authorizations", {
    method: "POST",
    headers: { "x-admin-key": "admin-test-key" },
    body: JSON.stringify({ expires_in: "never" })
  });
  assert.equal(created.response.status, 201);
  assert.match(created.body.data.code, /^AH-/);
  assert.equal(created.body.data.authorization.status, "active");
  assert.equal(created.body.data.authorization.expires_at, undefined);
  const authorizationId = created.body.data.authorization.id;

  const listed = await request("/api/v1/admin/authorizations", { headers: { "x-admin-key": "admin-test-key" } });
  const listedAuthorization = listed.body.data.find((entry: { id: string }) => entry.id === authorizationId);
  assert.ok(listedAuthorization);
  assert.equal("code" in listedAuthorization, false);
  assert.equal("codeHash" in listedAuthorization, false);

  const registered = await request("/api/v1/devices/register", {
    method: "POST",
    body: JSON.stringify({ registration_code: created.body.data.code, name: "authorized-node", extension_version: "0.2.0" })
  });
  assert.equal(registered.response.status, 201);
  const authorizationToken = registered.body.data.access_token;

  const reused = await request("/api/v1/devices/register", {
    method: "POST",
    body: JSON.stringify({ registration_code: created.body.data.code, name: "duplicate-node", extension_version: "0.2.0" })
  });
  assert.equal(reused.response.status, 401);

  const deleted = await request(`/api/v1/admin/authorizations/${authorizationId}`, {
    method: "DELETE",
    headers: { "x-admin-key": "admin-test-key" }
  });
  assert.equal(deleted.response.status, 200);
  assert.equal(deleted.body.data.status, "revoked");

  const heartbeat = await request("/api/v1/devices/heartbeat", {
    method: "POST",
    headers: { authorization: `Bearer ${authorizationToken}` },
    body: JSON.stringify({ extension_version: "0.2.0", queue_depth: 0 })
  });
  assert.equal(heartbeat.response.status, 403);
});

test("materializes one-time and daily schedules without duplicate claims", async () => {
  const authorization = await request("/api/v1/admin/authorizations", {
    method: "POST",
    headers: { "x-admin-key": "admin-test-key" },
    body: JSON.stringify({ expires_in: "24h" })
  });
  const registered = await request("/api/v1/devices/register", {
    method: "POST",
    body: JSON.stringify({ registration_code: authorization.body.data.code, name: "scheduled-node", extension_version: "0.2.0" })
  });
  const scheduledDeviceId = registered.body.data.device.id;
  const scheduledToken = registered.body.data.access_token;
  const onceStartAt = new Date(Date.now() + 100).toISOString();
  const once = await request("/api/v1/admin/schedules", {
    method: "POST",
    headers: { "x-admin-key": "admin-test-key", "idempotency-key": "once-schedule" },
    body: JSON.stringify({ device_id: scheduledDeviceId, type: "capture_trending", recurrence: "once", start_at: onceStartAt, time_zone: "Asia/Shanghai" })
  });
  assert.equal(once.response.status, 201);
  await new Promise((resolve) => setTimeout(resolve, 130));

  const claimedOnce = await request("/api/v1/devices/tasks:claim", {
    method: "POST",
    headers: { authorization: `Bearer ${scheduledToken}` },
    body: "{}"
  });
  assert.equal(claimedOnce.body.data.task.schedule_id, once.body.data.id);

  const secondClaimWhileRunning = await request("/api/v1/devices/tasks:claim", {
    method: "POST",
    headers: { authorization: `Bearer ${scheduledToken}` },
    body: "{}"
  });
  assert.equal(secondClaimWhileRunning.body.data.task, null);

  const onceRun = await request("/api/v1/collection-runs", {
    method: "POST",
    headers: { authorization: `Bearer ${scheduledToken}`, "idempotency-key": "once-schedule-run" },
    body: JSON.stringify({ business_date: claimedOnce.body.data.task.business_date, source_url: "https://github.com/trending", filters: {} })
  });
  await request(`/api/v1/devices/tasks/${claimedOnce.body.data.task.id}:status`, {
    method: "POST",
    headers: { authorization: `Bearer ${scheduledToken}` },
    body: JSON.stringify({ status: "completed", run_id: onceRun.body.data.id })
  });

  const dailyStartAt = new Date(Date.now() + 100).toISOString();
  const daily = await request("/api/v1/admin/schedules", {
    method: "POST",
    headers: { "x-admin-key": "admin-test-key", "idempotency-key": "daily-schedule" },
    body: JSON.stringify({ device_id: scheduledDeviceId, type: "capture_trending", recurrence: "daily", start_at: dailyStartAt, time_zone: "Asia/Shanghai" })
  });
  await new Promise((resolve) => setTimeout(resolve, 130));
  const claimedDaily = await request("/api/v1/devices/tasks:claim", {
    method: "POST",
    headers: { authorization: `Bearer ${scheduledToken}` },
    body: "{}"
  });
  assert.equal(claimedDaily.body.data.task.schedule_id, daily.body.data.id);

  const schedules = await request("/api/v1/admin/schedules", { headers: { "x-admin-key": "admin-test-key" } });
  const onceState = schedules.body.data.find((entry: { id: string }) => entry.id === once.body.data.id);
  const dailyState = schedules.body.data.find((entry: { id: string }) => entry.id === daily.body.data.id);
  assert.equal(onceState.status, "completed");
  assert.equal(dailyState.status, "active");
  assert.ok(new Date(dailyState.next_run_at).getTime() > Date.now());

  const activeDailySchedules = await request(`/api/v1/admin/schedules?device_id=${encodeURIComponent(scheduledDeviceId)}&status=active&recurrence=daily`, { headers: { "x-admin-key": "admin-test-key" } });
  assert.equal(activeDailySchedules.response.status, 200);
  assert.equal(activeDailySchedules.body.meta.total, 1);
  assert.equal(activeDailySchedules.body.data[0].id, daily.body.data.id);

  const cancelled = await request(`/api/v1/admin/schedules/${daily.body.data.id}`, {
    method: "DELETE",
    headers: { "x-admin-key": "admin-test-key" }
  });
  assert.equal(cancelled.body.data.status, "cancelled");
});

test("supports heartbeat, idempotent runs, partial uploads, and revoke", async () => {
  const heartbeat = await request("/api/v1/devices/heartbeat", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ extension_version: "0.1.1", queue_depth: 2 })
  });
  assert.equal(heartbeat.response.status, 200);
  assert.equal(heartbeat.body.data.queue_depth, 2);

  const taskCreated = await request("/api/v1/admin/tasks", {
    method: "POST",
    headers: { "x-admin-key": "admin-test-key", "idempotency-key": "task-1" },
    body: JSON.stringify({ device_id: deviceId, type: "capture_trending", business_date: "2026-08-09" })
  });
  assert.equal(taskCreated.response.status, 201);
  const taskId = taskCreated.body.data.id;

  const claimed = await request("/api/v1/devices/tasks:claim", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    body: "{}"
  });
  assert.equal(claimed.response.status, 200);
  assert.equal(claimed.body.data.task.id, taskId);
  assert.equal(claimed.body.data.task.status, "running");

  const claimedAgain = await request("/api/v1/devices/tasks:claim", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    body: "{}"
  });
  assert.equal(claimedAgain.response.status, 200);
  assert.equal(claimedAgain.body.data.task, null);

  const taskHeartbeat = await request("/api/v1/devices/heartbeat", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ extension_version: "0.1.1", queue_depth: 0, task_id: taskId })
  });
  assert.equal(taskHeartbeat.response.status, 200);

  const deviceLog = await request("/api/v1/devices/logs", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ task_id: taskId, level: "warn", event: "capture_waiting", message: "Waiting for next project" })
  });
  assert.equal(deviceLog.response.status, 201);

  const taskRun = await request("/api/v1/collection-runs", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "idempotency-key": "task-run-1" },
    body: JSON.stringify({ business_date: "2026-08-09", source_url: "https://github.com/trending", filters: {} })
  });
  const taskCompleted = await request(`/api/v1/devices/tasks/${taskId}:status`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ status: "completed", run_id: taskRun.body.data.id })
  });
  assert.equal(taskCompleted.response.status, 200);
  assert.equal(taskCompleted.body.data.status, "completed");

  const invalidTransition = await request(`/api/v1/devices/tasks/${taskId}:status`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ status: "running" })
  });
  assert.equal(invalidTransition.response.status, 409);
  assert.equal(invalidTransition.body.code, "invalid_task_transition");

  const cancellableTask = await request("/api/v1/admin/tasks", {
    method: "POST",
    headers: { "x-admin-key": "admin-test-key", "idempotency-key": "task-2" },
    body: JSON.stringify({ device_id: deviceId, type: "capture_trending", business_date: "2026-08-09" })
  });
  const cancellableTaskId = cancellableTask.body.data.id;
  const claimedCancellableTask = await request("/api/v1/devices/tasks:claim", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    body: "{}"
  });
  assert.equal(claimedCancellableTask.body.data.task.id, cancellableTaskId);

  const cancelledTask = await request(`/api/v1/admin/tasks/${cancellableTaskId}:cancel`, {
    method: "POST",
    headers: { "x-admin-key": "admin-test-key" }
  });
  assert.equal(cancelledTask.response.status, 200);
  assert.equal(cancelledTask.body.data.status, "cancelled");

  const cancellationHeartbeat = await request("/api/v1/devices/heartbeat", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ extension_version: "0.1.1", queue_depth: 0, task_id: cancellableTaskId })
  });
  assert.equal(cancellationHeartbeat.body.data.task_cancelled, true);

  const repeatedCancellation = await request(`/api/v1/admin/tasks/${cancellableTaskId}:cancel`, {
    method: "POST",
    headers: { "x-admin-key": "admin-test-key" }
  });
  assert.equal(repeatedCancellation.response.status, 409);
  assert.equal(repeatedCancellation.body.code, "task_not_cancellable");

  const taskPage = await request("/api/v1/admin/tasks?date=2026-08-09&page=1&page_size=1", { headers: { "x-admin-key": "admin-test-key" } });
  assert.equal(taskPage.response.status, 200);
  assert.equal(taskPage.body.data.length, 1);
  assert.equal(taskPage.body.meta.total, 2);
  assert.equal(taskPage.body.meta.page_size, 1);
  assert.equal(taskPage.body.meta.total_pages, 2);

  const allTasks = await request(`/api/v1/admin/tasks?device_id=${encodeURIComponent(deviceId)}&page=1&page_size=20`, { headers: { "x-admin-key": "admin-test-key" } });
  assert.equal(allTasks.body.meta.total, 2);
  const cancelledTasks = await request(`/api/v1/admin/tasks?device_id=${encodeURIComponent(deviceId)}&status=cancelled&page=1&page_size=20`, { headers: { "x-admin-key": "admin-test-key" } });
  assert.equal(cancelledTasks.body.meta.total, 1);
  assert.equal(cancelledTasks.body.data[0].id, cancellableTaskId);

  const logs = await request(`/api/v1/admin/logs?device_id=${encodeURIComponent(deviceId)}&limit=10`, { headers: { "x-admin-key": "admin-test-key" } });
  assert.equal(logs.response.status, 200);
  assert.ok(logs.body.data.some((entry: { event: string }) => entry.event === "heartbeat"));
  assert.ok(logs.body.data.some((entry: { event: string }) => entry.event === "capture_waiting"));

  const runPayload = { business_date: "2026-08-09", source_url: "https://github.com/trending", filters: {} };
  const created = await request("/api/v1/collection-runs", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "idempotency-key": "run-1" },
    body: JSON.stringify(runPayload)
  });
  assert.equal(created.response.status, 201);
  runId = created.body.data.id;

  const repeated = await request("/api/v1/collection-runs", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "idempotency-key": "run-1" },
    body: JSON.stringify(runPayload)
  });
  assert.equal(repeated.response.status, 200);
  assert.equal(repeated.body.data.id, runId);

  const item = {
    project_url: "https://github.com/Acme/Demo",
    rank: 1,
    name: "Acme Demo",
    readme_html: "<h1>Demo</h1>",
    readme_text: "Demo",
    read_at: "2026-08-09T00:00:00.000Z",
    status: "success"
  };
  const uploaded = await request(`/api/v1/collection-runs/${runId}/items:batch`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ items: [item] })
  });
  assert.equal(uploaded.response.status, 200);
  assert.equal(uploaded.body.data.accepted, 1);

  const duplicate = await request(`/api/v1/collection-runs/${runId}/items:batch`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ items: [item] })
  });
  assert.equal(duplicate.body.data.duplicates, 1);

  const runs = await request("/api/v1/admin/runs?date=2026-08-09", { headers: { "x-admin-key": "admin-test-key" } });
  assert.equal(runs.response.status, 200);
  assert.equal(runs.body.data[0].itemCount, 1);

  const revoked = await request(`/api/v1/admin/devices/${deviceId}:revoke`, { method: "POST", headers: { "x-admin-key": "admin-test-key" } });
  assert.equal(revoked.response.status, 200);

  const afterRevoke = await request("/api/v1/devices/heartbeat", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ extension_version: "0.1.1", queue_depth: 0 })
  });
  assert.equal(afterRevoke.response.status, 403);
});

test("supports local development mode without registration or admin keys", async () => {
  const localDirectory = await mkdtemp(join(tmpdir(), "automation-hub-dev-"));
  const localStore = new FileStore(join(localDirectory, "store.json"));
  await localStore.initialize();
  const localServer = createApiServer({ store: localStore, corsOrigin: "http://localhost:5173", authEnabled: false });
  await new Promise<void>((resolve) => localServer.listen(0, resolve));
  const address = localServer.address() as AddressInfo;
  const localUrl = `http://127.0.0.1:${address.port}`;
  const localRequest = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${localUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) }
    });
    return { response, body: await response.json() };
  };

  try {
    const registered = await localRequest("/api/v1/devices/register", {
      method: "POST",
      body: JSON.stringify({ name: "local-node", extension_version: "0.2.0" })
    });
    assert.equal(registered.response.status, 200);
    const localDeviceId = registered.body.data.device.id;

    const heartbeat = await localRequest("/api/v1/devices/heartbeat", {
      method: "POST",
      headers: { "x-device-id": localDeviceId },
      body: JSON.stringify({ extension_version: "0.2.0", queue_depth: 0 })
    });
    assert.equal(heartbeat.response.status, 200);

    const runs = await localRequest("/api/v1/admin/runs?date=2026-08-09");
    assert.equal(runs.response.status, 200);
    assert.deepEqual(runs.body.data, []);

    const authorization = await localRequest("/api/v1/admin/authorizations", {
      method: "POST",
      body: JSON.stringify({ expires_in: "24h" })
    });
    const authorizedDevice = await localRequest("/api/v1/devices/register", {
      method: "POST",
      body: JSON.stringify({ registration_code: authorization.body.data.code, name: "authorized-local-node", extension_version: "0.2.0" })
    });
    assert.equal(authorizedDevice.response.status, 201);
    const authorizedDeviceId = authorizedDevice.body.data.device.id;

    await localRequest(`/api/v1/admin/authorizations/${authorization.body.data.authorization.id}`, { method: "DELETE" });
    const revokedHeartbeat = await localRequest("/api/v1/devices/heartbeat", {
      method: "POST",
      headers: { "x-device-id": authorizedDeviceId },
      body: JSON.stringify({ extension_version: "0.2.0", queue_depth: 0 })
    });
    assert.equal(revokedHeartbeat.response.status, 403);
  } finally {
    await new Promise<void>((resolve, reject) => localServer.close((error) => error ? reject(error) : resolve()));
    await rm(localDirectory, { recursive: true, force: true });
  }
});

test("notification channel API accepts proxy settings and returns only a credential-free hint", async () => {
  const proxyDirectory = await mkdtemp(join(tmpdir(), "automation-hub-proxy-api-"));
  const storePath = join(proxyDirectory, "store.json");
  const proxyStore = new FileStore(storePath);
  await proxyStore.initialize();
  const proxyRequests: string[] = [];
  const proxyServer = createApiServer({
    store: proxyStore,
    corsOrigin: "http://localhost:5173",
    authEnabled: false,
    modelEncryptionKey: "proxy-api-test-encryption-key",
    telegramProxyRequest: async (url) => {
      proxyRequests.push(url);
      return {
        ok: true,
        status: 200,
        body: { ok: true, result: { id: 77, username: "api_proxy_bot", first_name: "API Proxy Bot" } }
      };
    }
  });
  await new Promise<void>((resolve) => proxyServer.listen(0, resolve));
  const address = proxyServer.address() as AddressInfo;
  const proxyBaseUrl = `http://127.0.0.1:${address.port}`;
  const proxyUrl = "https://api-user:api-password@proxy.example.test:8443";
  const proxyRequest = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${proxyBaseUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) }
    });
    return { response, body: await response.json() };
  };

  try {
    const created = await proxyRequest("/api/v1/admin/notification-channels", {
      method: "POST",
      body: JSON.stringify({
        type: "telegram",
        name: "API 代理 Bot",
        bot_token: "777777:api-token",
        proxy_url: proxyUrl,
        proxy_enabled: true,
        enabled: true
      })
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.data.proxy_enabled, true);
    assert.equal(created.body.data.proxy_configured, true);
    assert.equal(created.body.data.proxy_url_hint, "https://proxy.example.test:8443");
    assert.equal("proxy_url" in created.body.data, false);
    assert.doesNotMatch(JSON.stringify(created.body), /api-password|api-user|777777:api-token/);
    assert.equal(proxyRequests.length, 1);

    const listed = await proxyRequest("/api/v1/admin/notification-channels");
    assert.equal(listed.body.data[0].proxy_url_hint, "https://proxy.example.test:8443");
    assert.doesNotMatch(JSON.stringify(listed.body), /api-password|api-user|777777:api-token/);

    const raw = await readFile(storePath, "utf8");
    assert.match(raw, /api-password|api-user/);
    assert.doesNotMatch(raw, /777777:api-token/);
  } finally {
    await new Promise<void>((resolve, reject) => proxyServer.close((error) => error ? reject(error) : resolve()));
    await proxyStore.close();
    await rm(proxyDirectory, { recursive: true, force: true });
  }
});

test("serves the built admin and falls back for history routes", async () => {
  const staticDirectory = await mkdtemp(join(tmpdir(), "automation-hub-static-"));
  const staticStore = new FileStore(join(staticDirectory, "data", "store.json"));
  const adminDirectory = join(staticDirectory, "admin");
  await mkdir(adminDirectory, { recursive: true });
  await writeFile(join(adminDirectory, "index.html"), "<!doctype html><title>AutomationHub</title>", "utf8");
  await staticStore.initialize();
  const staticServer = createApiServer({ store: staticStore, corsOrigin: "*", authEnabled: false, adminDistPath: adminDirectory });
  await new Promise<void>((resolve) => staticServer.listen(0, resolve));
  const address = staticServer.address() as AddressInfo;

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/tasks`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await response.text(), /AutomationHub/);
  } finally {
    await new Promise<void>((resolve, reject) => staticServer.close((error) => error ? reject(error) : resolve()));
    await rm(staticDirectory, { recursive: true, force: true });
  }
});
