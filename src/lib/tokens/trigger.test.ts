import { describe, expect, it } from "vitest";
import { applyTokenPick, filterTokenNames, findTokenTrigger } from "./trigger";

describe("findTokenTrigger", () => {
  it("каноническая скобка открывает подсказку", () => {
    expect(findTokenTrigger("баланс ⟦", 8)).toEqual({ start: 7, query: "" });
  });

  it("запрос растёт по мере набора", () => {
    expect(findTokenTrigger("баланс ⟦вкл", 11)).toEqual({ start: 7, query: "вкл" });
  });

  it("закрытый токен подсказку не открывает", () => {
    expect(findTokenTrigger("баланс ⟦вклад⟧", 14)).toBeNull();
  });

  it("каретка внутри токена до закрывающей скобки — подсказка ещё нужна", () => {
    expect(findTokenTrigger("баланс ⟦вклад⟧", 13)).toEqual({ start: 7, query: "вклад" });
  });

  it("без открывающей скобки подсказки нет", () => {
    expect(findTokenTrigger("просто текст", 6)).toBeNull();
  });

  it("терпимые формы [[ и {{ тоже открывают подсказку", () => {
    expect(findTokenTrigger("[[счёт", 6)).toEqual({ start: 0, query: "счёт" });
    expect(findTokenTrigger("{{аренда", 8)).toEqual({ start: 0, query: "аренда" });
  });

  it("перевод строки закрывает подсказку", () => {
    expect(findTokenTrigger("⟦имя\nещё", 9)).toBeNull();
  });

  it("слишком длинный хвост — не имя", () => {
    expect(findTokenTrigger(`⟦${"я".repeat(80)}`, 81)).toBeNull();
  });

  it("берёт самое позднее открытие", () => {
    const text = "⟦старый⟧ и ⟦но";
    expect(findTokenTrigger(text, text.length)).toEqual({ start: 11, query: "но" });
  });

  it("кривая каретка прижимается к границам", () => {
    expect(findTokenTrigger("⟦имя", 99)).toEqual({ start: 0, query: "имя" });
    expect(findTokenTrigger("⟦имя", -5)).toBeNull();
  });
});

describe("applyTokenPick", () => {
  it("заменяет набранный фрагмент готовым токеном", () => {
    const text = "баланс ⟦вк";
    const trigger = findTokenTrigger(text, text.length);
    expect(trigger).not.toBeNull();
    expect(applyTokenPick(text, text.length, "вклад ВТБ", trigger!)).toEqual({
      text: "баланс ⟦вклад ВТБ⟧",
      caret: 18,
    });
  });

  it("сохраняет текст после каретки и ставит пробел перед словом", () => {
    const text = "⟦вк остаток";
    const trigger = findTokenTrigger(text, 3);
    const result = applyTokenPick(text, 3, "счёт", trigger!);
    expect(result.text).toBe("⟦счёт⟧ остаток");
    expect(result.caret).toBe(6);
  });

  it("не ставит пробел перед знаком препинания", () => {
    const text = "⟦вк, дальше";
    const trigger = findTokenTrigger(text, 3);
    expect(applyTokenPick(text, 3, "счёт", trigger!).text).toBe("⟦счёт⟧, дальше");
  });

  it("пустое имя оставляет текст как есть", () => {
    const trigger = { start: 0, query: "" };
    expect(applyTokenPick("⟦", 1, "   ", trigger)).toEqual({ text: "⟦", caret: 1 });
  });
});

describe("filterTokenNames", () => {
  const names = ["вклад ВТБ", "ВТБ-вклад", "аренда", "счёт", "вклад Альфа"];

  it("фильтрует по подстроке без учёта регистра", () => {
    expect(filterTokenNames(names, "втб")).toEqual(["ВТБ-вклад", "вклад ВТБ"]);
  });

  it("начинающиеся с запроса — выше остальных", () => {
    expect(filterTokenNames(names, "втб")[0]).toBe("ВТБ-вклад");
  });

  it("пустой запрос отдаёт весь список с ограничением", () => {
    expect(filterTokenNames(names, "", 3)).toHaveLength(3);
  });

  it("нет совпадений — пустой список", () => {
    expect(filterTokenNames(names, "ипотека")).toEqual([]);
  });
});
