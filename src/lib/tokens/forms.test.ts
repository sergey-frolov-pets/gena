import { describe, expect, it } from "vitest";

import { forgetForms, lookupForm, rememberForm, tokenIndexAt } from "./forms";

describe("tokenIndexAt", () => {
  it("считает только токены с тем же именем", () => {
    const text = "⟦вклад⟧ и ⟦почта⟧ и ⟦вклад⟧";
    expect(tokenIndexAt(text, "вклад", 0)).toBe(0);
    expect(tokenIndexAt(text, "вклад", text.length)).toBe(2);
    expect(tokenIndexAt(text, "почта", text.length)).toBe(1);
  });

  it("имя сравнивает без учёта регистра", () => {
    const text = "⟦Вклад⟧ … ⟦вклад⟧";
    expect(tokenIndexAt(text, "вклад", text.length)).toBe(2);
  });
});

describe("rememberForm / lookupForm", () => {
  it("возвращает форму, с которой токен вставили", () => {
    const store = new Map<string, string>();
    const text = "перевёл вклада ВТБ дальше";
    const at = text.indexOf("вклада");
    rememberForm(store, text, "вклад", at, "вклада ВТБ");
    const replaced = "перевёл ⟦вклад⟧ дальше";
    expect(lookupForm(store, replaced, "вклад", replaced.indexOf("⟦"))).toBe(
      "вклада ВТБ",
    );
  });

  it("различает одноимённые вхождения по номеру", () => {
    const store = new Map<string, string>();
    // Как в поле: первое вхождение токенизировали, потом второе.
    const afterFirst = "⟦вклад⟧ и вклада ВТБ";
    rememberForm(store, "вклад ВТБ и вклада ВТБ", "вклад", 0, "вклад ВТБ");
    rememberForm(
      store,
      afterFirst,
      "вклад",
      afterFirst.indexOf("вклада"),
      "вклада ВТБ",
    );
    const replaced = "⟦вклад⟧ и ⟦вклад⟧";
    const first = replaced.indexOf("⟦");
    const second = replaced.lastIndexOf("⟦");
    expect(lookupForm(store, replaced, "вклад", first)).toBe("вклад ВТБ");
    expect(lookupForm(store, replaced, "вклад", second)).toBe("вклада ВТБ");
  });

  it("пустая форма не запоминается", () => {
    const store = new Map<string, string>();
    rememberForm(store, "⟦имя⟧", "имя", 0, "   ");
    expect(lookupForm(store, "⟦имя⟧", "имя", 0)).toBeNull();
  });

  it("неизвестное вхождение — null", () => {
    const store = new Map<string, string>();
    expect(lookupForm(store, "⟦имя⟧ ⟦имя⟧", "имя", 10)).toBeNull();
  });
});

describe("forgetForms", () => {
  it("убирает формы одной записи и не трогает соседние", () => {
    const store = new Map<string, string>();
    const text = "⟦вклад⟧ ⟦почта⟧";
    rememberForm(store, text, "вклад", 0, "вклад ВТБ");
    rememberForm(store, text, "почта", text.indexOf("⟦почта"), "a@b.ru");
    forgetForms(store, "ВКЛАД");
    expect(lookupForm(store, "⟦вклад⟧", "вклад", 0)).toBeNull();
    expect(lookupForm(store, "⟦почта⟧", "почта", 0)).toBe("a@b.ru");
  });
});
