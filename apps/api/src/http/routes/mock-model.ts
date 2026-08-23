import type { ServerResponse } from "node:http";
import { readJson } from "../request.js";
import type { HttpContext } from "../context.js";

export async function routeMockModel(context: HttpContext): Promise<boolean> {
  if (!context.options.modelSandboxEnabled) return false;

  const { request, response, url, options } = context;
  if (request.method === "GET" && url.pathname === "/api/v1/mock-model/v1/models") {
    writeMockResponse(response, 200, {
      status: "success",
      data: [{ id: "mock-gpt-4o-mini", name: "本地开发模型" }]
    }, options.corsOrigin);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/mock-model/v1/chat/completions") {
    const body = (await readJson(request)) as { messages?: Array<{ content?: unknown }> };
    const lastMessage = body.messages?.at(-1);
    const prompt = typeof lastMessage?.content === "string" ? lastMessage.content : "";
    const projectUrls = [...prompt.matchAll(/^地址：(https?:\/\/\S+)$/gm)].map((match) => match[1]);
    const content = JSON.stringify({
      project_analyses: projectUrls.map((projectUrl, index) => ({
        project_url: projectUrl,
        category: "开发者工具",
        purpose: `本地测试项目 ${index + 1} 的用途说明。`,
        attention_reason: "内置 mock 模型返回，用于本地联调日报生成。"
      }))
    });
    writeMockResponse(response, 200, {
      id: "mock-chat-completion",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1_000),
      model: "mock-gpt-4o-mini",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content }
        }
      ]
    }, options.corsOrigin);
    return true;
  }

  return false;
}

function writeMockResponse(response: ServerResponse, statusCode: number, payload: unknown, corsOrigin: string): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": corsOrigin,
    "access-control-allow-headers": "content-type, authorization, idempotency-key, x-admin-key, x-device-id",
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS"
  });
  response.end(JSON.stringify(payload));
}
