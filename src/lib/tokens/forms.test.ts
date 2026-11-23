import { describe, expect, it } from "vitest";

import {
  forgetForms,
  formAt,
  formLookup,
  lookupForm,
  rememberForm,
  setForm,
  shiftForms,
  tokenIndexAt,
  applyForms,
  assignForms,
  formsOf,
  keepForms,
  keptForms,
  preferForms,
  type FormStore,
} from "./forms";

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

describe("shiftForms", () => {
  it("«Заменить все»: формы не съезжают, когда токены вставляли с конца", () => {
    const store = new Map<string, string>();
    // Человек нажал «Заменить все»: идём с последнего вхождения к первому.
    let text = "перевёл ВТБ и ВТБ";
    const hits: Array<{ start: number; end: number }> = [];
    let from = 0;
    for (;;) {
      const at = text.indexOf("ВТБ", from);
      if (at < 0) break;
      hits.push({ start: at, end: at + 3 });
      from = at + 3;
    }
    for (let i = hits.length - 1; i >= 0; i -= 1) {
      const hit = hits[i];
      rememberForm(
        store,
        text,
        "вклад",
        hit.start,
        text.slice(hit.start, hit.end),
      );
      text = `${text.slice(0, hit.start)}⟦вклад⟧${text.slice(hit.end)}`;
    }
    expect(text).toBe("перевёл ⟦вклад⟧ и ⟦вклад⟧");
    const first = text.indexOf("⟦");
    const second = text.lastIndexOf("⟦");
    expect(lookupForm(store, text, "вклад", first)).toBe("ВТБ");
    expect(lookupForm(store, text, "вклад", second)).toBe("ВТБ");
  });

  it("вставка токена в начало сдвигает формы прежних вхождений", () => {
    const store = new Map<string, string>();
    // ⟦вклад⟧ уже стоит, его форма — под номером 0.
    rememberForm(store, "⟦вклад⟧ и вклада ВТБ", "вклад", 0, "вклад ВТБ");
    // Руками вставили ещё один ⟦вклад⟧ в самое начало: прежний стал вторым.
    shiftForms(store, "вклад", 0);
    const text = "⟦вклад⟧ ⟦вклад⟧ и вклада ВТБ";
    const last = text.lastIndexOf("⟦");
    expect(lookupForm(store, text, "вклад", last)).toBe("вклад ВТБ");
  });

  it("сдвиг не задевает другие имена", () => {
    const store = new Map<string, string>();
    rememberForm(store, "⟦почта⟧ и тут", "почта", 0, "a@b.ru");
    shiftForms(store, "вклад", 0);
    expect(lookupForm(store, "⟦почта⟧", "почта", 0)).toBe("a@b.ru");
  });
});

describe("applyForms: формы из перекодировки поля", () => {
  it("раскладывает формы по порядку одноимённых токенов", () => {
    const store: FormStore = new Map();
    applyForms(store, "⟦вклад⟧ и ⟦вклад⟧", [
      { name: "вклад", form: "вклада ВТБ" },
      { name: "вклад", form: "вкладу ВТБ" },
    ]);
    expect(formAt(store, "вклад", 0)).toBe("вклада ВТБ");
    expect(formAt(store, "вклад", 1)).toBe("вкладу ВТБ");
  });

  it("не трогает имена, которых в тексте нет", () => {
    const store: FormStore = new Map();
    applyForms(store, "⟦вклад⟧", [{ name: "почта", form: "a@b.ru" }]);
    expect(store.size).toBe(0);
  });

  it("пустые формы игнорируются", () => {
    const store: FormStore = new Map();
    applyForms(store, "⟦вклад⟧", [{ name: "вклад", form: "   " }]);
    expect(formAt(store, "вклад", 0)).toBeNull();
  });

  it("резолвер отдаёт форму по имени и номеру", () => {
    const store: FormStore = new Map();
    rememberForm(store, "⟦вклад⟧", "вклад", 0, "вклада ВТБ");
    const lookup = formLookup(store);
    expect(lookup("вклад", 0)).toBe("вклада ВТБ");
    expect(lookup("вклад", 1)).toBeNull();
  });
});

describe("setForm", () => {
  it("меняет форму вхождения и не сдвигает следующую", () => {
    const store: FormStore = new Map();
    const text = "⟦я⟧ и ⟦я⟧";
    assignForms(store, text, ["Сергея", "Сергею"]);
    setForm(store, text, "я", 0, "мной");
    expect(formsOf(store, text)).toEqual(["мной", "Сергею"]);
  });
});

describe("перенос форм в другой текст", () => {
  it("снимает формы по порядку токенов и кладёт их в новый текст", () => {
    const store: FormStore = new Map();
    const source = "⟦я⟧ видит ⟦я⟧";
    assignForms(store, source, ["Сергея", "Сергею"]);
    expect(formsOf(store, source)).toEqual(["Сергея", "Сергею"]);

    const next: FormStore = new Map();
    assignForms(next, "для ⟦я⟧ и к ⟦я⟧", formsOf(store, source));
    expect(formAt(next, "я", 0)).toBe("Сергея");
    expect(formAt(next, "я", 1)).toBe("Сергею");
  });

  it("стирает чужие формы тех же имён", () => {
    const store: FormStore = new Map();
    assignForms(store, "⟦я⟧ ⟦я⟧", ["Сергея", "Сергею"]);
    assignForms(store, "⟦я⟧", ["меня"]);
    expect(formsOf(store, "⟦я⟧ ⟦я⟧")).toEqual(["меня", ""]);
  });

  it("предпочитает сохранённую форму угаданной", () => {
    expect(preferForms(["Сергея", ""], ["Сергей", "Сергею"])).toEqual([
      "Сергея",
      "Сергею",
    ]);
    expect(preferForms(["только одна"], ["Сергей", "Сергею"])).toEqual([
      "Сергей",
      "Сергею",
    ]);
  });

  it("помнит формы отправленной реплики по id", () => {
    keepForms("msg-1", ["Сергея", "Сергею"]);
    expect(keptForms("msg-1")).toEqual(["Сергея", "Сергею"]);
    keepForms("msg-1", ["", ""]);
    expect(keptForms("msg-1")).toBeNull();
  });
});
