import { describe, expect, it } from "vitest";
import { insertTokenAt, tokenLiteral } from "./insert";

describe("tokenLiteral", () => {
  it("оборачивает имя в канон и убирает пробелы по краям", () => {
    expect(tokenLiteral("  вклад ВТБ ")).toBe("⟦вклад ВТБ⟧");
  });
});

describe("insertTokenAt", () => {
  it("вставляет токен в конец пустого поля", () => {
    expect(insertTokenAt("", 0, "вклад")).toEqual({ text: "⟦вклад⟧", caret: 7 });
  });

  it("вставляет по курсору в середину текста", () => {
    const result = insertTokenAt("Остаток на  сейчас", 11, "счёт");
    expect(result.text).toBe("Остаток на ⟦счёт⟧ сейчас");
    expect(result.caret).toBe(17);
  });

  it("добавляет пробел, если токен слипся бы со словом", () => {
    expect(insertTokenAt("Остатокна", 7, "счёт")).toEqual({
      text: "Остаток ⟦счёт⟧ на",
      caret: 14,
    });
  });

  it("прижимает кривой курсор к границам текста", () => {
    expect(insertTokenAt("привет", 99, "имя").text).toBe("привет ⟦имя⟧");
    expect(insertTokenAt("привет", -5, "имя").text).toBe("⟦имя⟧ привет");
  });

  it("не дублирует уже стоящий рядом токен", () => {
    const once = insertTokenAt("⟦имя⟧", 6, "имя");
    expect(once).toEqual({ text: "⟦имя⟧", caret: 5 });
    const twice = insertTokenAt("⟦имя⟧", 0, "имя");
    expect(twice).toEqual({ text: "⟦имя⟧", caret: 0 });
  });

  it("пустое имя не меняет текст", () => {
    expect(insertTokenAt("текст", 5, "   ")).toEqual({ text: "текст", caret: 5 });
  });
});
