import { describe, expect, it } from "vitest";
import {
  findOccurrences,
  needlePattern,
  replaceAllInText,
  replaceSpan,
  stepIndex,
  tokenSpans,
} from "./occurrences";

describe("findOccurrences", () => {
  it("находит все вхождения и регистр не важен", () => {
    const text = "Цена 1 200 ₽ и ещё цена 1 200 ₽ тут";
    const hits = findOccurrences(text, "цена 1 200 ₽");
    expect(hits.map((hit) => hit.start)).toEqual([0, 19]);
    expect(hits[0].blocked).toBeUndefined();
  });

  it("понимает неразрывные и двойные пробелы", () => {
    const text = "итог 1\u00a0200 ₽ и 1  200 ₽";
    expect(findOccurrences(text, "1 200 ₽")).toHaveLength(2);
    expect(needlePattern("1 200 ₽")).toBe("1\\s+200\\s+₽");
  });

  it("пропускает вхождения внутри токенов", () => {
    const text = "⟦цена⟧ и цена";
    const hits = findOccurrences(text, "цена");
    expect(hits).toHaveLength(1);
    expect(hits[0].start).toBe(9);
    expect(findOccurrences(text, "цена", { includeBlocked: true })[0].blocked).toBe("token");
  });

  it("блокирует совпадение внутри слова", () => {
    const hits = findOccurrences("расчёт по счёту", "счёт", { includeBlocked: true });
    expect(hits).toHaveLength(2);
    expect(hits[0].blocked).toBe("word");
    expect(hits[1].blocked).toBe("word");
    expect(findOccurrences("расчёт по счёту", "счёт")).toHaveLength(0);
  });

  it("учитывает регистр по флагу", () => {
    const text = "Счёт и счёт";
    expect(findOccurrences(text, "счёт")).toHaveLength(2);
    expect(findOccurrences(text, "счёт", { caseSensitive: true })).toHaveLength(1);
  });

  it("слишком короткий фрагмент не ищет", () => {
    expect(findOccurrences("и и и", "и")).toEqual([]);
    expect(findOccurrences("", "цена")).toEqual([]);
  });
});

describe("tokenSpans", () => {
  it("находит несколько токенов", () => {
    expect(tokenSpans("⟦a⟧ текст ⟦b c⟧")).toEqual([
      { start: 0, end: 3 },
      { start: 10, end: 15 },
    ]);
  });
});

describe("замена", () => {
  it("заменяет один диапазон", () => {
    expect(replaceSpan("цена 1 200 ₽", 0, 4, "⟦цена⟧")).toBe("⟦цена⟧ 1 200 ₽");
  });

  it("заменяет все вхождения в тексте с конца", () => {
    const result = replaceAllInText("ВТБ и ВТБ, вклад ВТБ", "ВТБ", "⟦втб⟧");
    expect(result.replaced).toBe(3);
    expect(result.text).toBe("⟦втб⟧ и ⟦втб⟧, вклад ⟦втб⟧");
  });

  it("не трогает токены и части слов", () => {
    const result = replaceAllInText("⟦втб⟧ и ВТБ-банк", "ВТБ", "⟦втб⟧");
    expect(result.replaced).toBe(1);
    expect(result.text).toBe("⟦втб⟧ и ⟦втб⟧-банк");
  });

  it("по умолчанию регистр не важен", () => {
    const result = replaceAllInText("Счёт и счёт", "счёт", "⟦счёт⟧");
    expect(result.replaced).toBe(2);
    expect(result.text).toBe("⟦счёт⟧ и ⟦счёт⟧");
  });

  it("с галочкой регистра меняет только точное написание", () => {
    const result = replaceAllInText("Счёт и счёт", "счёт", "⟦счёт⟧", {
      caseSensitive: true,
    });
    expect(result.replaced).toBe(1);
    expect(result.text).toBe("Счёт и ⟦счёт⟧");
  });
});

describe("stepIndex", () => {
  it("ходит по кругу", () => {
    expect(stepIndex(0, 3, 1)).toBe(1);
    expect(stepIndex(2, 3, 1)).toBe(0);
    expect(stepIndex(0, 3, -1)).toBe(2);
    expect(stepIndex(5, 0, 1)).toBe(0);
  });
});
