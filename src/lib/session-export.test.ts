import { describe, expect, it } from "vitest";
import { markdownFileName, sessionToMarkdown } from "./session-export";
import { normalizeServerUrl } from "./gena-server";
import type { Message, Session } from "@/storage/types";

const session: Session = {
  id: "sess_1",
  agentId: "agent_1",
  title: "Вклады и ставки",
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  messageCount: 2,
  tags: ["вклады"],
};

const messages: Message[] = [
  { id: "m1", sessionId: "sess_1", role: "user", content: "вопрос", createdAt: 1_700_000_000_000 },
  {
    id: "m2",
    sessionId: "sess_1",
    role: "assistant",
    content: "ответ",
    createdAt: 1_700_000_060_000,
    model: "ds-pro",
  },
  { id: "m3", sessionId: "sess_1", role: "assistant", content: "думаю", kind: "thought", createdAt: 1_700_000_070_000 },
];

describe("экспорт диалога в markdown", () => {
  it("заголовок, участники, модель и мысли модели", () => {
    const text = sessionToMarkdown(session, messages);
    expect(text).toContain("# Вклады и ставки");
    expect(text).toContain("**Вы**");
    expect(text).toContain("**Агент** · `ds-pro`");
    expect(text).toContain("> думаю");
    expect(text).toContain("теги: вклады");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("пустой диалог не падает", () => {
    expect(sessionToMarkdown({ ...session, title: "" }, [])).toContain("# Новый диалог");
  });

  it("имя файла без запрещённых символов", () => {
    expect(markdownFileName("Вклады/ставки: 2027")).toBe("Вклады ставки 2027.md");
    expect(markdownFileName("   ")).toBe("gena.md");
    expect(markdownFileName("a".repeat(100)).length).toBeLessThanOrEqual(63);
  });
});

describe("адрес сервера Gena", () => {
  it("дописывает схему и убирает хвост /api", () => {
    expect(normalizeServerUrl("gena.example.com")).toBe("https://gena.example.com");
    expect(normalizeServerUrl("https://gena.example.com/api/")).toBe("https://gena.example.com");
    expect(normalizeServerUrl("127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
    expect(normalizeServerUrl("  ")).toBe("");
  });
});
