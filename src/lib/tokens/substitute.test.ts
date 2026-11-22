import { describe, expect, it } from "vitest";
import { valuesToTokens, buildNeedles, countValueHits } from "./substitute";

const entries = [
  {
    name: "вклад ВТБ",
    value: "вклад ВТБ",
    variants: ["вклада ВТБ", "ВТБ вклад", "ВТБ-вклад"],
  },
  {
    name: "аренда",
    value: "Квартира на Ленина, 15",
    variants: ["Ленина 15"],
  },
];

describe("tokens/substitute: значения → токены", () => {
  it("многословное значение заменяется целиком", () => {
    expect(valuesToTokens("Открыл вклад ВТБ на год", entries).text).toBe("Открыл ⟦вклад ВТБ⟧ на год");
  });

  it("падежи и другой порядок слов берутся из variants", () => {
    expect(valuesToTokens("проценты по вкладу ВТБ", entries).text).toBe("проценты по вкладу ВТБ");
    expect(valuesToTokens("открытие вклада ВТБ", entries).text).toBe("открытие ⟦вклад ВТБ⟧");
    expect(valuesToTokens("ВТБ-вклад закрыл", entries).text).toBe("⟦вклад ВТБ⟧ закрыл");
  });

  it("регистр не важен", () => {
    expect(valuesToTokens("ВКЛАД втб", entries).text).toBe("⟦вклад ВТБ⟧");
  });

  it("границы слова соблюдаются", () => {
    const result = valuesToTokens("медвклад ВТБилет", entries);
    expect(result.hits).toBe(0);
    expect(result.text).toBe("медвклад ВТБилет");
  });

  it("самое длинное совпадение выигрывает", () => {
    const list = [
      { name: "дом", value: "Ленина" },
      { name: "аренда", value: "Ленина, 15" },
    ];
    expect(valuesToTokens("адрес: Ленина, 15", list).text).toBe("адрес: ⟦аренда⟧");
    expect(valuesToTokens("улица Ленина", list).text).toBe("улица ⟦дом⟧");
  });

  it("уже стоящий токен не оборачивается повторно (идемпотентность)", () => {
    const once = valuesToTokens("вклад ВТБ и ещё вклад ВТБ", entries);
    expect(once.text).toBe("⟦вклад ВТБ⟧ и ещё ⟦вклад ВТБ⟧");
    expect(once.hits).toBe(2);
    const twice = valuesToTokens(once.text, entries);
    expect(twice.text).toBe(once.text);
    expect(twice.hits).toBe(0);
  });

  it("[[…]] и {{…}} в тексте приводятся к канону", () => {
    expect(valuesToTokens("баланс [[аренда]]", entries).text).toBe("баланс ⟦аренда⟧");
  });

  it("однобуквенные значения не участвуют", () => {
    expect(buildNeedles([{ name: "я", value: "я" }])).toEqual([]);
  });

  it("значение со скобками токена пропускается", () => {
    expect(buildNeedles([{ name: "плохой", value: "⟦уже токен⟧" }])).toEqual([]);
  });

  it("счётчик вхождений совпадает с заменой", () => {
    expect(countValueHits("вклад ВТБ, вклад ВТБ и ещё раз вклад ВТБ", entries)).toBe(3);
  });

  it("пустой текст и пустой справочник безопасны", () => {
    expect(valuesToTokens("", entries)).toEqual({ text: "", hits: 0 });
    expect(valuesToTokens("текст", [])).toEqual({ text: "текст", hits: 0 });
  });
});
