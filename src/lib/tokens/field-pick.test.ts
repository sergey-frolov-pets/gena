import { describe, expect, it } from "vitest";
import {
  describeFieldPick,
  listForms,
  replaceFieldPick,
  tokenAtCaret,
  valueAtCaret,
} from "./field-pick";

const entries = [
  { name: "банк", value: "ВТБ" },
  { name: "сумма1", value: "1 200 ₽", variants: ["1200 ₽"] },
  { name: "фио", value: "Иван Петров" },
  { name: "город", value: "Москва" },
];

describe("listForms", () => {
  it("собирает канон, варианты и падежи без повторов", () => {
    expect(listForms("вклад ВТБ", ["вклада ВТБ", "Вклад ВТБ"], ["вкладу ВТБ", "вклада втб"])).toEqual([
      "вклад ВТБ",
      "вклада ВТБ",
      "вкладу ВТБ",
    ]);
  });
});

describe("tokenAtCaret", () => {
  it("находит токен под кареткой", () => {
    const text = "вклад в ⟦банк⟧ открыт";
    const caret = text.indexOf("⟦") + 2;
    expect(tokenAtCaret(text, caret)).toEqual({
      start: text.indexOf("⟦"),
      end: text.indexOf("⟧") + 1,
      name: "банк",
    });
  });

  it("каретка сразу после ⟧ — ещё этот токен", () => {
    const text = "⟦банк⟧ и всё";
    expect(tokenAtCaret(text, "⟦банк⟧".length)?.name).toBe("банк");
  });

  it("каретка в обычном тексте — не токен", () => {
    expect(tokenAtCaret("просто текст", 5)).toBeNull();
  });

  it("пустое имя токена не считается", () => {
    expect(tokenAtCaret("⟦ ⟧", 2)).toBeNull();
  });
});

describe("valueAtCaret", () => {
  it("находит значение под кареткой", () => {
    const text = "перевёл в ВТБ сегодня";
    const found = valueAtCaret(text, text.indexOf("ВТБ") + 1, entries);
    expect(found?.entry.name).toBe("банк");
    expect(text.slice(found!.start, found!.end)).toBe("ВТБ");
  });

  it("длинное совпадение важнее короткого", () => {
    const short = [{ name: "имя", value: "Иван" }, { name: "фио", value: "Иван Петров" }];
    const text = "пишет Иван Петров";
    expect(valueAtCaret(text, text.indexOf("Петров"), short)?.entry.name).toBe("фио");
  });

  it("вариант записи тоже находится", () => {
    const text = "итого 1200 ₽ вышло";
    expect(valueAtCaret(text, text.indexOf("1200"), entries)?.entry.name).toBe("сумма1");
  });

  it("внутри слова значение не находится", () => {
    const text = "расчёт по счёту";
    const only = [{ name: "счёт", value: "счёт" }];
    expect(valueAtCaret(text, 1, only)).toBeNull();
  });

  it("внутри токена значение не находится", () => {
    const text = "⟦город⟧";
    expect(valueAtCaret(text, 2, entries)).toBeNull();
  });
});

describe("describeFieldPick", () => {
  it("токен в черновике → tokenized", () => {
    const text = "вклад в ⟦банк⟧ открыт";
    const pick = describeFieldPick(text, text.indexOf("⟦") + 3, entries)!;
    expect(pick.tokenized).toBe(true);
    expect(pick.name).toBe("банк");
    expect(pick.value).toBe("ВТБ");
    expect(pick.text).toBe("⟦банк⟧");
  });

  it("значение в черновике → не tokenized", () => {
    const text = "вклад в ВТБ открыт";
    const pick = describeFieldPick(text, text.indexOf("ВТБ") + 1, entries)!;
    expect(pick.tokenized).toBe(false);
    expect(pick.name).toBe("банк");
    expect(pick.value).toBe("ВТБ");
    expect(pick.text).toBe("ВТБ");
  });

  it("токен без записи в справочнике не показываем", () => {
    const text = "⟦чужой⟧";
    expect(describeFieldPick(text, 2, entries)).toBeNull();
  });

  it("обычный текст → null", () => {
    expect(describeFieldPick("привет, как дела", 4, entries)).toBeNull();
  });
});

describe("replaceFieldPick", () => {
  it("значение → токен, каретка за токеном", () => {
    const text = "вклад в ВТБ открыт";
    const pick = describeFieldPick(text, text.indexOf("ВТБ"), entries)!;
    const result = replaceFieldPick(text, pick, "token");
    expect(result.text).toBe("вклад в ⟦банк⟧ открыт");
    expect(result.caret).toBe("вклад в ⟦банк⟧".length);
    expect(result.changed).toBe(true);
  });

  it("токен → значение, остальные вхождения не трогаем", () => {
    const text = "⟦банк⟧ и ⟦банк⟧";
    const pick = describeFieldPick(text, 2, entries)!;
    const result = replaceFieldPick(text, pick, "value");
    expect(result.text).toBe("ВТБ и ⟦банк⟧");
    expect(result.caret).toBe("ВТБ".length);
  });

  it("длинное значение возвращается целиком", () => {
    const text = "клиент Иван Петров";
    const pick = describeFieldPick(text, text.indexOf("Петров"), entries)!;
    expect(replaceFieldPick(text, pick, "token").text).toBe("клиент ⟦фио⟧");
  });

  it("токен → значение: возвращает исходную форму, а не канон", () => {
    const text = "перевёл ⟦банк⟧ дальше";
    const pick = describeFieldPick(text, text.indexOf("⟦") + 2, entries)!;
    const result = replaceFieldPick(text, pick, "value", "банка ВТБ");
    expect(result.text).toBe("перевёл банка ВТБ дальше");
  });

  it("пустое значение не пишем", () => {
    const pick = { tokenized: true, name: "банк", value: "  ", start: 0, end: 7, text: "⟦банк⟧" };
    const result = replaceFieldPick("⟦банк⟧", pick, "value");
    expect(result.changed).toBe(false);
    expect(result.text).toBe("⟦банк⟧");
  });
});
