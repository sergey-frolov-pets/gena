import { beforeEach, describe, expect, it } from "vitest";
import {
  draftOffsetForVisible,
  draftText,
  toDraftCaret,
  toVisibleCaret,
  visibleOffsetForDraft,
  visibleText,
} from "./display";
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

  it("в защищённом режиме показывается ровно то, что уйдёт агенту", () => {
    expect(visibleText("Открыл ⟦вклад ВТБ⟧ на год", false)).toBe("Открыл ⟦вклад ВТБ⟧ на год");
  });

  it("набранные в режиме значений значения возвращаются в токены", () => {
    expect(draftText("Открыл вклад ВТБ на год", true)).toBe("Открыл ⟦вклад ВТБ⟧ на год");
  });

  it("защищённый режим черновик не переписывает", () => {
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

describe("исходные формы в поле", () => {
  beforeEach(() => {
    tokenEntries.value = entries.map((entry) => ({ ...entry }));
  });

  it("показывает форму вхождения, а не канон записи", () => {
    const forms = (_name: string, index: number) =>
      index === 0 ? "вклада ВТБ" : index === 1 ? "вкладу ВТБ" : null;
    expect(visibleText("⟦вклад ВТБ⟧ и ⟦вклад ВТБ⟧", true, forms)).toBe(
      "вклада ВТБ и вкладу ВТБ",
    );
  });

  it("нет формы — канон справочника", () => {
    expect(visibleText("⟦вклад ВТБ⟧", true, () => null)).toBe("вклад ВТБ");
    expect(visibleText("⟦вклад ВТБ⟧", true)).toBe("вклад ВТБ");
  });

  it("перекодировка поля сообщает, какие написания стали токенами", () => {
    const hits: Array<{ name: string; form: string }> = [];
    const draft = draftText("Открыл вклад ВТБ вчера", true, (hit) => hits.push(hit));
    expect(draft).toBe("Открыл ⟦вклад ВТБ⟧ вчера");
    expect(hits).toEqual([{ name: "вклад ВТБ", form: "вклад ВТБ" }]);
  });

  it("клик по длинной форме попадает в короткий токен", () => {
    const forms = () => "вклада в банке ВТБ";
    const draft = "оплата ⟦вклад ВТБ⟧ сегодня";
    const shown = visibleText(draft, true, forms);
    const inside = shown.indexOf("банке");
    const at = draftOffsetForVisible(draft, inside, true, forms);
    const start = draft.indexOf("⟦");
    const end = draft.indexOf("⟧") + 1;
    expect(at).toBeGreaterThanOrEqual(start);
    expect(at).toBeLessThan(end);
    expect(visibleOffsetForDraft(draft, start, true, forms)).toBe(shown.indexOf("вклада"));
  });

  it("конец токена приходится на конец формы, а не на текст следующей строки", () => {
    const forms = () => "Орлов";
    const draft = "⟦имя⟧\nдиректор";
    const shown = visibleText(draft, true, forms);
    const end = draft.indexOf("⟧") + 1;
    expect(visibleOffsetForDraft(draft, end, true, forms)).toBe("Орлов".length);
    expect(shown[visibleOffsetForDraft(draft, end, true, forms)]).toBe("\n");
  });

  it("в защищённом режиме форм не собирает", () => {
    const hits: Array<{ name: string; form: string }> = [];
    draftText("⟦вклад ВТБ⟧", false, (hit) => hits.push(hit));
    expect(hits).toEqual([]);
  });
});
