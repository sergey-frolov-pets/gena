import { describe, expect, it } from "vitest";
import {
  categoryBase,
  findSelectionEntry,
  fragmentTokenName,
  NAME_BASES,
  normalizeFragment,
  replaceRange,
  suggestTokenNames,
} from "./selection";

const entries = [
  { id: "1", name: "вклад ВТБ", value: "ВТБ", variants: ["вклада ВТБ"] },
  { id: "2", name: "счёт", value: "текущий счёт" },
];

describe("выделение и справочник", () => {
  it("нормализует пробелы и регистр", () => {
    expect(normalizeFragment("  ВТБ   вклад ")).toBe("втб вклад");
  });

  it("находит запись по значению и варианту", () => {
    expect(findSelectionEntry("втб", entries)?.name).toBe("вклад ВТБ");
    expect(findSelectionEntry("Вклада ВТБ", entries)?.name).toBe("вклад ВТБ");
  });

  it("чужое значение не находит и короткое не ищет", () => {
    expect(findSelectionEntry("Альфа-Банк", entries)).toBeNull();
    expect(findSelectionEntry("В", entries)).toBeNull();
  });

  it("находит запись по имени и по уже вставленному токену", () => {
    expect(findSelectionEntry("счёт", entries)?.name).toBe("счёт");
    expect(findSelectionEntry("вклад ВТБ", entries)?.name).toBe("вклад ВТБ");
    expect(findSelectionEntry("⟦вклад ВТБ⟧", entries)?.name).toBe("вклад ВТБ");
    expect(findSelectionEntry("[[счёт]]", entries)?.name).toBe("счёт");
  });

  it("выделенный токен без записи в справочнике не считается заменой", () => {
    expect(findSelectionEntry("⟦нет такого⟧", entries)).toBeNull();
    expect(fragmentTokenName("⟦счёт⟧")).toBe("счёт");
    expect(fragmentTokenName("обычный текст")).toBe("");
  });

  it("заменяет диапазон и ставит каретку за вставкой", () => {
    const result = replaceRange("цена 1 200 ₽", 0, 4, "⟦сумма1⟧");
    expect(result.text).toBe("⟦сумма1⟧ 1 200 ₽");
    expect(result.caret).toBe("⟦сумма1⟧".length);
  });
});

describe("категория значения", () => {
  it("видит сумму, телефон, компанию, дату и почту", () => {
    expect(categoryBase("1 200 ₽")).toBe(NAME_BASES.amount);
    expect(categoryBase("1 200,00")).toBe(NAME_BASES.amount);
    expect(categoryBase("+7 916 123-45-67")).toBe(NAME_BASES.phone);
    expect(categoryBase("ООО Ромашка")).toBe(NAME_BASES.company);
    expect(categoryBase("12.03.2027")).toBe(NAME_BASES.date);
    expect(categoryBase("ivan@example.com")).toBe(NAME_BASES.email);
  });

  it("обычный текст категории не даёт", () => {
    expect(categoryBase("Альфа-Банк")).toBe("");
  });
});

describe("предложение имени токена", () => {
  it("берёт первое значимое слово и нумерует с единицы", () => {
    expect(suggestTokenNames("цена 1 200 ₽")).toEqual(["цена1", "сумма1", "имя1"]);
  });

  it("пропускает предлоги и служебные слова", () => {
    expect(suggestTokenNames("во вкладе ВТБ")[0]).toBe("вкладе1");
  });

  it("сохраняет кириллицу и убирает пунктуацию", () => {
    expect(suggestTokenNames("«Альфа-Банк»,")[0]).toBe("альфабанк1");
  });

  it("без букв берёт категорию, затем имя", () => {
    expect(suggestTokenNames("1 200,00 ₽")).toEqual(["сумма1", "имя1"]);
    expect(suggestTokenNames("1 200,00 ₽", ["сумма1"])).toEqual(["сумма2", "имя1"]);
    expect(suggestTokenNames("1 200,00 ₽", ["сумма1", "сумма2"])).toEqual(["сумма3", "имя1"]);
  });

  it("телефон и компания получают своё имя", () => {
    expect(suggestTokenNames("+7 916 123-45-67")[0]).toBe("телефон1");
    expect(suggestTokenNames("ООО Ромашка")).toEqual(["ромашка1", "компания1", "имя1"]);
  });

  it("занятое имя получает следующий номер", () => {
    expect(suggestTokenNames("ВТБ", ["втб1"])).toEqual(["втб2", "имя1"]);
    expect(suggestTokenNames("ВТБ", ["втб1", "втб2"])[0]).toBe("втб3");
  });

  it("второе слово — альтернатива, повторы не выдаёт", () => {
    expect(suggestTokenNames("счёт в Альфа Банке")).toEqual(["счёт1", "альфа1", "имя1"]);
  });

  it("уважает лимит", () => {
    expect(suggestTokenNames("счёт Альфа Банк", [], 1)).toEqual(["счёт1"]);
  });

  it("пустой текст — базовое имя с номером", () => {
    expect(suggestTokenNames("   ")).toEqual(["имя1"]);
  });
});
