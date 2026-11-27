/**
 * Транспорт `gena_server`: запрос уходит на наш Go-сервер, ключ провайдера
 * на устройство не попадает.
 */

import { describe, expect, it } from "vitest";
import type { Agent, Message } from "@/storage/types";
import { AgentClientError } from "./client-error";
import { chatUrl, genaServerTransport, parseServerReply } from "./gena-server";

function serverAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "srv:s1:ds-chat",
    name: "DeepSeek Chat",
    address: "https://gena.example.com",
    sealedKey: "enc:v1:xxx",
    settings: { contextSize: 10, callLimit: 0, llmModel: "deepseek-chat" },
    protocol: "gena_server",
    config: { serverId: "s1", agentId: "ds-chat", model: "deepseek-chat" },
    origin: "server",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function history(): Message[] {
  return [
    { id: "m1", sessionId: "s", role: "user", content: "старое", createdAt: 1 },
    { id: "m2", sessionId: "s", role: "assistant", content: "ответ", createdAt: 2 },
    { id: "m3", sessionId: "s", role: "assistant", content: "мысль", kind: "thought", createdAt: 3 },
  ];
}

function sseResponse(chunks: string[]): Response {
  const body = chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`).join("") +
    "data: [DONE]\n\n";
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

describe("транспорт gena_server", () => {
  it("строит адрес с экранированием id агента", () => {
    expect(chatUrl("https://host/", "ds chat")).toBe("https://host/api/agents/ds%20chat/chat");
  });

  it("шлёт историю, токен и получает стрим", async () => {
    let url = "";
    let auth = "";
    let body: { messages?: Array<{ role: string; content: string }> } = {};
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input);
      auth = new Headers(init?.headers).get("Authorization") ?? "";
      body = JSON.parse(String(init?.body ?? "{}"));
      return sseResponse(["При", "вет"]);
    }) as typeof fetch;

    const deltas: string[] = [];
    const reply = await genaServerTransport.send(
      {
        agent: serverAgent(),
        apiKey: "server-token",
        sessionId: "s",
        message: "как дела?",
        history: history(),
        signal: new AbortController().signal,
        fetchImpl,
      },
      { onDelta: (_id, chunk) => deltas.push(chunk) },
    );

    expect(url).toBe("https://gena.example.com/api/agents/ds-chat/chat");
    expect(auth).toBe("Bearer server-token");
    expect(deltas.join("")).toBe("Привет");
    expect(reply.reply).toBe("Привет");
    // Мысли в контекст не идут, текущая реплика — последняя.
    const wire = body.messages ?? [];
    expect(wire.map((m) => m.content)).toEqual(["старое", "ответ", "как дела?"]);
  });

  it("ошибку сервера отдаёт с кодом и текстом", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: "агент не найден" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    await expect(
      genaServerTransport.send(
        {
          agent: serverAgent(),
          apiKey: "t",
          sessionId: "s",
          message: "привет",
          history: [],
          signal: new AbortController().signal,
          fetchImpl,
        },
        {},
      ),
    ).rejects.toMatchObject({ status: 404, message: expect.stringContaining("агент не найден") });
  });

  it("без agentId в конфиге — понятная ошибка, а не запрос в пустоту", async () => {
    const agent = serverAgent({ config: { serverId: "s1" } as never });
    await expect(
      genaServerTransport.send(
        {
          agent,
          apiKey: "t",
          sessionId: "s",
          message: "привет",
          history: [],
          signal: new AbortController().signal,
          fetchImpl: (async () => sseResponse(["x"])) as typeof fetch,
        },
        {},
      ),
    ).rejects.toBeInstanceOf(AgentClientError);
  });

  it("обычный JSON вместо SSE тоже разбирается", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "целый ответ" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    const reply = await genaServerTransport.send(
      {
        agent: serverAgent(),
        apiKey: "t",
        sessionId: "s",
        message: "привет",
        history: [],
        signal: new AbortController().signal,
        fetchImpl,
      },
      {},
    );
    expect(reply.reply).toBe("целый ответ");
  });

  it("parseServerReply склеивает куски SSE", () => {
    const text =
      'data: {"choices":[{"delta":{"content":"a"}}]}\n\ndata: {"choices":[{"delta":{"content":"b"}}]}\n\n';
    expect(parseServerReply(text)).toBe("ab");
  });
});
