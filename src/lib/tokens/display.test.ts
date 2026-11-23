import { beforeEach, describe, expect, it } from "vitest";
import { draftText, toDraftCaret, toVisibleCaret, visibleText } from "./display";
import { tokenEntries } from "./registry";

const entries = [
  {
    id: "t1",
    name: "вклад ВТБ",
    value: "вклад ВТБ",
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: "t2",
    name: "сумма",
    value: "1 234 567 ₽",
    createdAt: 2,
    updatedAt: 2,
  },
];

describe("tokens/display: поле ввода в двух режимах", () => {
  beforeEach(() => {
    tokenEntries.value = entries.map((entry) => ({ ...entry }));
  });

  it("в режиме значений токены расшифровываются", () => {
    expect(visibleText("Открыл ⟦вклад ВТБ⟧ на год", true)).toBe("Открыл вклад ВТБ на год");
  });

  it("в режиме токенов показывается ровно то, что уйдёт агенту", () => {
    expect(visibleText("Открыл ⟦вклад ВТБ⟧ на год", false)).toBe("Открыл ⟦вклад ВТБ⟧ на год");
  });

  it("набранные в режиме значений значения возвращаются в токены", () => {
    expect(draftText("Открыл вклад ВТБ на год", true)).toBe("Открыл ⟦вклад ВТБ⟧ на год");
  });

  it("режим токенов черновик не переписывает", () => {
    expect(draftText("Открыл ⟦вклад ВТБ⟧", false)).toBe("Открыл ⟦вклад ВТБ⟧");
  });

  it("каретка в конце набранного значения встаёт за токен", () => {
    const visible = "Открыл вклад ВТБ";
    const draft = draftText(visible, true);
    expect(draft).toBe("Открыл ⟦вклад ВТБ⟧");
    const caret = toDraftCaret(visible, visible.length, true);
    expect(caret).toBe(draft.length);
    expect(toVisibleCaret(draft, caret, true)).toBe(visible.length);
  });

  it("каретка внутри обычного текста не сдвигается", () => {
    expect(toDraftCaret("Привет мир", 6, true)).toBe(6);
  });

  it("обратная перекодировка возвращает каретку на то же место", () => {
    const visible = "Цена 1 234 567 ₽ за всё";
    const draft = draftText(visible, true);
    expect(draft).toBe("Цена ⟦сумма⟧ за всё");
    const caret = toDraftCaret(visible, visible.length, true);
    expect(toVisibleCaret(draft, caret, true)).toBe(visible.length);
    // Середина значения: каретка остаётся в тех же видимых символах.
    const mid = "Цена 1 234 567 ₽".length - 3;
    const midCaret = toDraftCaret(visible, mid, true);
    expect(toVisibleCaret(draft, midCaret, true)).toBeGreaterThanOrEqual(mid - 1);
    expect(toVisibleCaret(draft, midCaret, true)).toBeLessThanOrEqual(visible.length);
  });

  it("без режима значений смещения отдаются как есть", () => {
    expect(toDraftCaret("⟦сумма⟧", 5, false)).toBe(5);
    expect(toVisibleCaret("⟦сумма⟧", 5, false)).toBe(5);
  });
});
