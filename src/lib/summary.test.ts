import { describe, expect, it } from "vitest";
import { cleanSummary, summaryInstruction, transcriptOfProject, transcriptOfSession } from "./summary";
import type { Message } from "@/storage/types";

function message(partial: Partial<Message> & { role: Message["role"]; content: string }): Message {
  return {
    id: `m-${partial.content.slice(0, 4)}`,
    sessionId: "s1",
    createdAt: 1,
    ...partial,
  } as Message;
}

describe("transcriptOfSession", () => {
  it("подписывает роли и пропускает мысли и вызовы инструментов", () => {
    const text = transcriptOfSession({ title: "A" }, [
      message({ role: "user", content: "привет" }),
      message({ role: "assistant", content: "думаю", kind: "thought" }),
      message({ role: "assistant", content: "здравствуйте" }),
    ]);
    expect(text).toBe("Пользователь: привет\n\nАгент: здравствуйте");
  });
});

describe("transcriptOfProject", () => {
  it("каждую сессию под заголовком, пустые пропускает", () => {
    const text = transcriptOfProject([
      { session: { title: "Первая" }, messages: [message({ role: "user", content: "раз" })] },
      { session: { title: "Пустая" }, messages: [] },
      { session: { title: "Вторая" }, messages: [message({ role: "user", content: "два" })] },
    ]);
    expect(text).toContain("### Первая");
    expect(text).toContain("### Вторая");
    expect(text).not.toContain("### Пустая");
  });
});

describe("summaryInstruction", () => {
  it("требует фактов и открытых вопросов", () => {
    const prompt = summaryInstruction("Пенсия", "Пользователь: вклад", "session");
    expect(prompt).toContain("один диалог «Пенсия»");
    expect(prompt).toContain("Открытые вопросы");
    expect(prompt).toContain("Пользователь: вклад");
  });

  it("для проекта формулировка другая", () => {
    expect(summaryInstruction("Gena", "текст", "project")).toContain("несколько диалогов одного проекта");
  });
});

describe("cleanSummary", () => {
  it("снимает блок кода", () => {
    expect(cleanSummary("```markdown\n- пункт\n```")).toBe("- пункт");
  });

  it("обычный текст не трогает", () => {
    expect(cleanSummary("  - пункт  ")).toBe("- пункт");
  });
});
