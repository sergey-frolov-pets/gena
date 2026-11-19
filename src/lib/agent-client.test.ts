import { describe, expect, it } from "vitest";
import { sendToAgent, trimHistory, AgentClientError } from "./agent-client";
import type { Agent, Message } from "@/storage/types";

function msg(id: string, role: Message["role"] = "user"): Message {
  return { id, sessionId: "s", role, content: id, createdAt: 0 };
}

const agent: Agent = {
  id: "a1",
  name: "A",
  address: "https://agent.test/chat",
  sealedKey: "enc:v1:x.y",
  settings: { contextSize: 2, callLimit: 0, llmModel: "m" },
  createdAt: 0,
  updatedAt: 0,
};

describe("trimHistory", () => {
  const history = [msg("1"), msg("2"), msg("3"), msg("4")];

  it("0 — пустая история", () => {
    expect(trimHistory(history, 0)).toEqual([]);
  });

  it("отрицательное — пустая история", () => {
    expect(trimHistory(history, -3)).toEqual([]);
  });

  it("больше длины — вся история", () => {
    expect(trimHistory(history, 100)).toHaveLength(4);
  });

  it("берёт последние N в исходном порядке", () => {
    expect(trimHistory(history, 2).map((m) => m.id)).toEqual(["3", "4"]);
  });
});

describe("sendToAgent", () => {
  it("шлёт обрезанную историю и Bearer-ключ", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(JSON.stringify({ reply: "ok" }), { status: 200 });
    }) as unknown as typeof fetch;

    const res = await sendToAgent(
      agent,
      "secret",
      {
        message: "hi",
        sessionId: "s",
        settings: agent.settings,
        history: [msg("1"), msg("2"), msg("3")],
      },
      fakeFetch,
    );

    expect(res.reply).toBe("ok");
    expect(captured).not.toBeNull();
    const headers = (captured as unknown as { init: RequestInit }).init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret");
    const body = JSON.parse((captured as unknown as { init: RequestInit }).init.body as string);
    expect(body.history).toHaveLength(2);
    expect(body.history.map((h: { content: string }) => h.content)).toEqual(["2", "3"]);
  });

  it("нет адреса — AgentClientError", async () => {
    await expect(
      sendToAgent({ ...agent, address: "" }, "k", {
        message: "hi",
        sessionId: "s",
        settings: agent.settings,
        history: [],
      }),
    ).rejects.toBeInstanceOf(AgentClientError);
  });

  it("429 — ошибка со статусом", async () => {
    const fakeFetch = (async () => new Response("", { status: 429 })) as unknown as typeof fetch;
    await expect(
      sendToAgent(agent, "k", {
        message: "hi",
        sessionId: "s",
        settings: agent.settings,
        history: [],
      }, fakeFetch),
    ).rejects.toMatchObject({ status: 429 });
  });

  it("ответ без reply — ошибка", async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ nope: 1 }), { status: 200 })) as unknown as typeof fetch;
    await expect(
      sendToAgent(agent, "k", {
        message: "hi",
        sessionId: "s",
        settings: agent.settings,
        history: [],
      }, fakeFetch),
    ).rejects.toThrow(/reply/);
  });
});
