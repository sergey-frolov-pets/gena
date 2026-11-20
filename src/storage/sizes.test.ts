import { describe, expect, it } from "vitest";
import { aggregateSizes } from "./sizes";
import { recordBytes } from "@/lib/sizes";
import type { Agent, Message, Session } from "./types";

function makeAgent(id: string): Agent {
  return {
    id,
    name: id,
    address: "https://x",
    sealedKey: "",
    settings: { contextSize: 5, callLimit: 0, llmModel: "" },
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeSession(id: string, agentId: string): Session {
  return { id, agentId, title: id, createdAt: 1, updatedAt: 1, messageCount: 0 };
}

function makeMessage(id: string, sessionId: string, content: string): Message {
  return { id, sessionId, role: "user", content, createdAt: 1 };
}

describe("aggregateSizes", () => {
  it("складывает агентов, сессии и сообщения", () => {
    const agents = [makeAgent("a1")];
    const sessions = [makeSession("s1", "a1"), makeSession("s2", "a1")];
    const messages = [
      makeMessage("m1", "s1", "привет"),
      makeMessage("m2", "s1", "ещё"),
      makeMessage("m3", "s2", "в другом диалоге"),
    ];

    const sizes = aggregateSizes(agents, sessions, messages);

    expect(sizes.agentCount).toBe(1);
    expect(sizes.sessionCount).toBe(2);
    expect(sizes.messageCount).toBe(3);
    expect(sizes.agentBytes).toBe(recordBytes(agents[0]));
    expect(sizes.sessionBytes).toBe(recordBytes(sessions[0]) + recordBytes(sessions[1]));
    expect(sizes.messageBytes).toBe(messages.map(recordBytes).reduce((a, b) => a + b, 0));
    expect(sizes.totalBytes).toBe(sizes.agentBytes + sizes.sessionBytes + sizes.messageBytes);
  });

  it("по сессии показывает всё вместе: запись + её сообщения", () => {
    const sessions = [makeSession("s1", "a1")];
    const messages = [
      makeMessage("m1", "s1", "первое"),
      makeMessage("m2", "s1", "второе"),
    ];

    const sizes = aggregateSizes([], sessions, messages);
    const entry = sizes.sessions.s1;

    expect(entry.messageCount).toBe(2);
    expect(entry.sessionBytes).toBe(recordBytes(sessions[0]));
    expect(entry.messageBytes).toBe(recordBytes(messages[0]) + recordBytes(messages[1]));
    expect(entry.totalBytes).toBe(entry.sessionBytes + entry.messageBytes);
    expect(entry.agentId).toBe("a1");
  });

  it("сообщения без сессии не ломают подсчёт", () => {
    const sizes = aggregateSizes([], [], [makeMessage("m1", "нет-такой", "текст")]);

    expect(sizes.messageCount).toBe(1);
    expect(sizes.sessions).toEqual({});
    expect(sizes.totalBytes).toBe(sizes.messageBytes);
  });

  it("пустая база — нули", () => {
    const sizes = aggregateSizes([], [], []);
    expect(sizes.totalBytes).toBe(0);
    expect(sizes.sessions).toEqual({});
  });
});
