import { describe, expect, it } from "vitest";
import { findSelectionEntry, normalizeFragment, replaceRange } from "./selection";

const entries = [
  { id: "1", name: "вклад ВТБ", value: "ВТБ", variants: ["вклада ВТБ"] },
  { id: "2", name: "счёт", value: "текущий счёт" },
];

describe("выделение и справочник", () => {
  it("нормализует пробелы и регистр", () => {
    expect(normalizeFragment("  ВТБ   вклад ")).toBe("втб вклад");
  });

  it("находит запись по значению без учёта регистра", () => {
    expect(findSelectionEntry("втб", entries)?.name).toBe("вклад ВТБ");
  });

  it("находит запись по варианту", () => {
    expect(findSelectionEntry("Вклада ВТБ", entries)?.name).toBe("вклад ВТБ");
  });

  it("не находит чужой фрагмент", () => {
    expect(findSelectionEntry("Альфа-Банк", entries)).toBeNull();
  });

  it("короткий фрагмент не считается значением", () => {
    expect(findSelectionEntry("В", entries)).toBeNull();
  });

  it("заменяет диапазон и ставит каретку за токеном", () => {
    const result = replaceRange("Мой ВТБ счёт", 4, 7, "⟦вклад ВТБ⟧");
    expect(result.text).toBe("Мой ⟦вклад ВТБ⟧ счёт");
    expect(result.caret).toBe(4 + "⟦вклад ВТБ⟧".length);
  });

  it("кривые границы прижимаются к тексту", () => {
    const result = replaceRange("abc", -5, 99, "⟦x⟧");
    expect(result.text).toBe("⟦x⟧");
    expect(result.caret).toBe("⟦x⟧".length);
  });
});
