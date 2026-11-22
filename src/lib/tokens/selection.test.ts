import { describe, expect, it } from "vitest";
import { findSelectionEntry, normalizeFragment, replaceRange, suggestTokenNames } from "./selection";

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

describe("предложение имени токена", () => {
  it("берёт первое значимое слово", () => {
    expect(suggestTokenNames("цена 1 200 ₽")).toEqual(["цена", "имя"]);
  });

  it("пропускает предлоги и служебные слова", () => {
    expect(suggestTokenNames("во вкладе ВТБ")[0]).toBe("вкладе");
  });

  it("сохраняет кириллицу и убирает пунктуацию", () => {
    expect(suggestTokenNames("«Альфа-Банк»,")[0]).toBe("альфабанк");
  });

  it("без букв даёт базовое имя с номером", () => {
    expect(suggestTokenNames("1 200,00 ₽")).toEqual(["имя"]);
    expect(suggestTokenNames("1 200,00 ₽", ["имя"])).toEqual(["имя2"]);
    expect(suggestTokenNames("1 200,00 ₽", ["имя", "имя2"])).toEqual(["имя3"]);
  });

  it("занятое имя получает номер", () => {
    expect(suggestTokenNames("ВТБ", ["втб"]).slice(0, 2)).toEqual(["втб2", "имя"]);
  });

  it("второе слово — альтернатива, повторы не выдаёт", () => {
    expect(suggestTokenNames("счёт в Альфа Банке")).toEqual(["счёт", "альфа", "имя"]);
  });

  it("уважает лимит", () => {
    expect(suggestTokenNames("счёт Альфа Банк", [], 1)).toEqual(["счёт"]);
  });

  it("пустой текст — базовое имя", () => {
    expect(suggestTokenNames("   ")).toEqual(["имя"]);
  });
});
