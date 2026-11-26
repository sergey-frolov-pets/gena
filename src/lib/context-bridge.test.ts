import { describe, expect, it } from "vitest";
import {
  CONTEXT_LIMIT,
  buildContextBlock,
  chipKey,
  chipLabel,
  composeMessage,
  makeChip,
  summaryUsable,
  truncateContext,
  type ContextPart,
} from "./context-bridge";

describe("чипы контекста", () => {
  it("ключ различает режим одного и того же источника", () => {
    expect(chipKey("session", "s1", "full")).not.toBe(chipKey("session", "s1", "summary"));
  });

  it("makeChip сам считает ключ", () => {
    const chip = makeChip({ kind: "project", mode: "summary", id: "p1", title: "Пенсия" });
    expect(chip.key).toBe("project:p1:summary");
    expect(chipLabel(chip)).toBe("Пенсия · саммари");
  });

  it("саммари годится, пока сервер не пометил его устаревшим", () => {
    const chip = makeChip({ kind: "session", mode: "summary", id: "s1", title: "A" });
    expect(summaryUsable(chip)).toBe(false);
    chip.summary = { text: "кратко", updatedAt: 1 };
    expect(summaryUsable(chip)).toBe(true);
    chip.summary = { text: "кратко", updatedAt: 1, stale: true };
    expect(summaryUsable(chip)).toBe(false);
  });

  it("пустой текст саммари не считается готовым", () => {
    const chip = makeChip({
      kind: "session",
      mode: "summary",
      id: "s1",
      title: "A",
      summary: { text: "   ", updatedAt: 1 },
    });
    expect(summaryUsable(chip)).toBe(false);
  });
});

describe("блок контекста", () => {
  it("без частей не добавляет заголовок", () => {
    expect(buildContextBlock([])).toBe("");
    expect(buildContextBlock([{ kind: "session", mode: "full", title: "A", body: "  " }])).toBe("");
  });

  it("подписывает режим и тип источника", () => {
    const parts: ContextPart[] = [
      { kind: "session", mode: "summary", title: "Пенсия", body: "вклад до 2027" },
      { kind: "project", mode: "full", title: "Gena", body: "чат 1", sessionCount: 3 },
    ];
    const block = buildContextBlock(parts);
    expect(block).toContain("## Контекст из других диалогов");
    expect(block).toContain("### Диалог «Пенсия» — саммари");
    expect(block).toContain("### Проект «Gena» — полный текст, 3 сессий");
    expect(block).toContain("вклад до 2027");
  });

  it("обрезает по лимиту и честно помечает обрезку", () => {
    const long = "слово ".repeat(CONTEXT_LIMIT);
    const cut = truncateContext(long, 500);
    expect(cut.truncated).toBe(true);
    expect(cut.text.length).toBeLessThanOrEqual(500);
    expect(cut.text).toContain("контекст обрезан");
  });

  it("короткий текст не меняется", () => {
    const cut = truncateContext("привет", 100);
    expect(cut).toEqual({ text: "привет", truncated: false });
  });

  it("composeMessage ставит контекст до вопроса", () => {
    const message = composeMessage("что дальше?", [
      { kind: "session", mode: "summary", title: "План", body: "решили начать с M1" },
    ]);
    const contextAt = message.indexOf("Контекст из других диалогов");
    const questionAt = message.indexOf("что дальше?");
    expect(contextAt).toBeGreaterThanOrEqual(0);
    expect(questionAt).toBeGreaterThan(contextAt);
    expect(message).toContain("---");
  });

  it("composeMessage без частей отдаёт исходный текст", () => {
    expect(composeMessage("просто вопрос", [])).toBe("просто вопрос");
  });
});
