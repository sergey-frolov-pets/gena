import { describe, expect, it } from "vitest";

import { detectFindings, summarize } from "./detect";
import { maskText } from "./mask";

function types(text: string): string[] {
  return detectFindings(text).map((f) => f.type);
}

describe("детектор приватных сущностей", () => {
  it("находит суммы в рублях в разных написаниях", () => {
    expect(types("вклад на 1 200 000 ₽")).toEqual(["money"]);
    expect(types("положил 350000 руб.")).toEqual(["money"]);
    expect(types("это 12,5 млн рублей")).toEqual(["money"]);
    expect(types("всего 900 р")).toEqual(["money"]);
  });

  it("находит суммы в валюте", () => {
    expect(types("$1,200 на счету")).toEqual(["money"]);
    expect(types("5000 USD")).toEqual(["money"]);
    expect(types("300 евро")).toEqual(["money"]);
  });

  it("находит даты числом и словом", () => {
    expect(types("гаснет 12.03.2027")).toEqual(["date"]);
    expect(types("до 12 марта 2027")).toEqual(["date"]);
  });

  it("находит телефон, почту и расчётный счёт", () => {
    expect(types("звони +7 999 123-45-67")).toEqual(["phone"]);
    expect(types("почта ivan.petrov@example.ru")).toEqual(["email"]);
    expect(types("счёт 40817810099910004312")).toEqual(["account"]);
  });

  it("карту ловит по Луну, случайные 16 цифр — нет", () => {
    expect(types("карта 4111 1111 1111 1111")).toEqual(["card"]);
    expect(types("номер 1234 5678 9012 3456")).toEqual([]);
  });

  it("не путает дату с суммой и не режет обычный текст", () => {
    expect(types("встреча 05.06.2026, потом обед")).toEqual(["date"]);
    expect(types("просто текст без цифр")).toEqual([]);
    expect(types("мне 42 года")).toEqual([]);
  });

  it("не находит пересечений и сортирует по позиции", () => {
    const found = detectFindings("карта 4111 1111 1111 1111, вклад 500 000 ₽");
    expect(found.map((f) => f.type)).toEqual(["card", "money"]);
    expect(found[0].start).toBeLessThan(found[1].start);
    for (let i = 1; i < found.length; i += 1) {
      expect(found[i].start).toBeGreaterThanOrEqual(found[i - 1].end);
    }
  });

  it("сводка считает по типам", () => {
    const summary = summarize(detectFindings("1000 ₽, 2000 ₽ и дата 01.02.2027"));
    expect(summary).toEqual([
      { type: "date", count: 1 },
      { type: "money", count: 2 },
    ]);
  });

  it("очень длинный текст не разбирается", () => {
    expect(detectFindings("1000 ₽ ".repeat(5000))).toEqual([]);
  });
});

describe("маскирование", () => {
  it("заменяет находки типом в скобках", () => {
    const text = "вклад 1 200 000 ₽ до 12.03.2027";
    const result = maskText(text, detectFindings(text));
    expect(result.text).toBe("вклад [сумма] до [дата]");
    expect(result.hidden).toBe(2);
  });

  it("ограничение по типам оставляет выбранное", () => {
    const text = "вклад 500 000 ₽, карта 4111 1111 1111 1111";
    const result = maskText(text, detectFindings(text), new Set(["money"] as const));
    expect(result.text).toBe("вклад [сумма], карта 4111 1111 1111 1111");
    expect(result.hidden).toBe(1);
  });

  it("пустой список ничего не меняет", () => {
    expect(maskText("привет", []).text).toBe("привет");
  });
});
