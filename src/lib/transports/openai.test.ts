import { describe, expect, it } from "vitest";
import { openaiTransport, extractSseDelta, extractUsage, parseSseEvent, parseSseEvents } from "./openai";
import { AgentClientError } from "./client-error";
import type { Agent, Message } from "@/storage/types";

function msg(id: string, role: Message["role"] = "user", kind?: Message["kind"]): Message {
  return { id, sessionId: "s", role, content: id, createdAt: 0, kind };
}

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "a1",
    name: "A",
    address: "https://api.test/v1",
    sealedKey: "enc:v1:x.y",
    settings: { contextSize: 2, callLimit: 0, llmModel: "fallback-model" },
    protocol: "openai",
    config: { model: "m1" },
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function fakeFetch(status: number, body: unknown) {
  return (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

const signal = new AbortController().signal;

describe("openaiTransport", () => {
  it("собирает system + обрезанный контекст + сообщение пользователя", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const a = agent({ config: { model: "m1", systemPrompt: "ты ассистент" } });
    const res = await openaiTransport.send(
      {
        agent: a,
        apiKey: "k",
        sessionId: "s",
        message: "hi",
        history: [msg("1"), msg("2"), msg("3")],
        signal,
        fetchImpl,
      },
      {},
    );

    expect(res.reply).toBe("ok");
    const init = (captured as unknown as { init: RequestInit }).init;
    expect((captured as unknown as { url: string }).url).toBe(
      "https://api.test/v1/chat/completions",
    );
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("m1");
    expect(body.stream).toBe(true);
    expect(body.messages).toEqual([
      { role: "system", content: "ты ассистент" },
      { role: "user", content: "2" },
      { role: "user", content: "3" },
      { role: "user", content: "hi" },
    ]);
  });

  it("фильтрует мысли и tool_calls из контекста", async () => {
    let body: { messages: unknown[] } = { messages: [] };
    const fetchImpl = (async (_: string, init: RequestInit) => {
      body = JSON.parse(init.body as string);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await openaiTransport.send(
      {
        agent: agent({ settings: { contextSize: 10, callLimit: 0, llmModel: "" } }),
        apiKey: "k",
        sessionId: "s",
        message: "hi",
        history: [
          msg("t", "assistant", "thought"),
          msg("c", "assistant", "tool_calls"),
          msg("ok", "user"),
        ],
        signal,
        fetchImpl,
      },
      {},
    );

    expect(body.messages).toEqual([
      { role: "user", content: "ok" },
      { role: "user", content: "hi" },
    ]);
  });

  it("model из config, а не settings.llmModel", async () => {
    let body: { model: string } = { model: "" };
    const fetchImpl = (async (_: string, init: RequestInit) => {
      body = JSON.parse(init.body as string);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await openaiTransport.send(
      {
        agent: agent({ config: { model: "m2" } }),
        apiKey: "k",
        sessionId: "s",
        message: "hi",
        history: [],
        signal,
        fetchImpl,
      },
      {},
    );
    expect(body.model).toBe("m2");
  });

  it("пустой/некорректный ответ → openai_empty", async () => {
    await expect(
      openaiTransport.send(
        {
          agent: agent(),
          apiKey: "k",
          sessionId: "s",
          message: "hi",
          history: [],
          signal,
          fetchImpl: fakeFetch(200, { choices: [] }),
        },
        {},
      ),
    ).rejects.toMatchObject({ code: "openai_empty" });
  });

  it("не-JSON ответ → not_json", async () => {
    const fetchImpl = (async () => new Response("not json", { status: 200 })) as unknown as typeof fetch;
    await expect(
      openaiTransport.send(
        {
          agent: agent(),
          apiKey: "k",
          sessionId: "s",
          message: "hi",
          history: [],
          signal,
          fetchImpl,
        },
        {},
      ),
    ).rejects.toMatchObject({ code: "not_json" });
  });

  it("429 → ошибка со статусом", async () => {
    await expect(
      openaiTransport.send(
        {
          agent: agent(),
          apiKey: "k",
          sessionId: "s",
          message: "hi",
          history: [],
          signal,
          fetchImpl: fakeFetch(429, { error: { message: "rate" } }),
        },
        {},
      ),
    ).rejects.toMatchObject({ status: 429 });
  });

  it("нет адреса → no_address", async () => {
    await expect(
      openaiTransport.send(
        {
          agent: agent({ address: "" }),
          apiKey: "k",
          sessionId: "s",
          message: "hi",
          history: [],
          signal,
          fetchImpl: fakeFetch(200, {}),
        },
        {},
      ),
    ).rejects.toBeInstanceOf(AgentClientError);
  });

  it("стримит SSE-дельты через onDelta", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      "data: [DONE]\n\n",
    ];
    const deltas: string[] = [];
    const res = await openaiTransport.send(
      {
        agent: agent(),
        apiKey: "k",
        sessionId: "s",
        message: "hi",
        history: [],
        signal,
        fetchImpl: (async () => sseResponse(chunks)) as unknown as typeof fetch,
      },
      {
        onDelta: (_id, chunk) => {
          deltas.push(chunk);
        },
      },
    );

    expect(res.reply).toBe("Hello");
    expect(deltas).toEqual(["Hel", "lo"]);
  });

  it("SSE-ошибка → openai_error с деталями", async () => {
    const chunks = ['data: {"error":{"message":"model not found"}}\n\n'];
    await expect(
      openaiTransport.send(
        {
          agent: agent(),
          apiKey: "k",
          sessionId: "s",
          message: "hi",
          history: [],
          signal,
          fetchImpl: (async () => sseResponse(chunks)) as unknown as typeof fetch,
        },
        {},
      ),
    ).rejects.toMatchObject({ code: "openai_error", detail: "model not found" });
  });
});

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("SSE-парсер", () => {
  it("parseSseEvent извлекает data-строки", () => {
    expect(parseSseEvent('data: {"a":1}\n\n')).toEqual({ a: 1 });
    expect(parseSseEvent('data: {"a":1}\ndata: {"b":2}\n\n')).toBeNull();
    expect(parseSseEvent("data: [DONE]")).toBeNull();
    expect(parseSseEvent(": comment\n")).toBeNull();
  });

  it("parseSseEvents собирает события и пропускает DONE", () => {
    const text = 'data: {"a":1}\n\ndata: {"b":2}\n\ndata: [DONE]\n\n';
    expect(parseSseEvents(text)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("extractUsage берёт prompt и completion из ответа", () => {
    expect(extractUsage({ usage: { prompt_tokens: 3, completion_tokens: 4 } })).toEqual({
      prompt_tokens: 3,
      completion_tokens: 4,
    });
    expect(extractUsage({ choices: [{ message: { content: "ok" } }] })).toBeUndefined();
  });

  it("extractSseDelta берёт delta.content или message.content", () => {
    expect(extractSseDelta({ choices: [{ delta: { content: "x" } }] })).toBe("x");
    expect(extractSseDelta({ choices: [{ message: { content: "y" } }] })).toBe("y");
    expect(extractSseDelta({ choices: [] })).toBeNull();
    expect(extractSseDelta(null)).toBeNull();
  });
});
