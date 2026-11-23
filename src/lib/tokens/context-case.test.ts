import { beforeEach, describe, expect, it } from "vitest";

import { attachMorphDictionary, declineValue } from "./morph/service";
import { SAMPLE } from "./morph/sample";
import {
  caseAfterPreposition,
  declineWithContext,
  contextForms,
  restoreValuesWithCase,
} from "./context-case";
import { tokenEntries } from "./registry";

beforeEach(() => {
  attachMorphDictionary(SAMPLE, { bytes: 1024, downloadedAt: 1_700_000_000_000 });
});

describe("context-case: падеж по предлогу", () => {
  it("узнаёт падеж предлога прямо перед токеном", () => {
    expect(caseAfterPreposition("перевёл в")).toEqual({ caseIndex: 3, plural: false });
    expect(caseAfterPreposition("думал о")).toEqual({ caseIndex: 5, plural: false });
    expect(caseAfterPreposition("ушёл из")).toEqual({ caseIndex: 1, plural: false });
    expect(caseAfterPreposition("к")).toEqual({ caseIndex: 2, plural: false });
  });

  it("без предлога падеж не выдумывает", () => {
    expect(caseAfterPreposition("вклад")).toBeNull();
    expect(caseAfterPreposition("")).toBeNull();
    expect(caseAfterPreposition("ВТБ")).toBeNull();
  });

  it("падеж предлога не зависит от регистра", () => {
    expect(caseAfterPreposition("Подумал О")).toEqual({ caseIndex: 5, plural: false });
  });

  it("склоняет значение в падеж предлога", () => {
    expect(declineWithContext("думал о ", "вклад ВТБ")).toBe("вкладе ВТБ");
    expect(declineWithContext("ушёл из ", "вклад ВТБ")).toBe("вклада ВТБ");
    expect(declineWithContext("подошёл к ", "вклад ВТБ")).toBe("вкладу ВТБ");
    expect(declineWithContext("в ", "улица Ленина")).toBe("улицу Ленина");
  });

  it("незнакомое слово остаётся каноном", () => {
    expect(declineWithContext("думал о ", "нечто")).toBe("нечто");
    expect(declineValue("нечто", 5)).toBeNull();
  });

  it("без предлога остаётся канон записи", () => {
    expect(declineWithContext("⟦вклад⟧", "вклад ВТБ")).toBe("вклад ВТБ");
  });

  it("в ленте подставляет падеж, а не канон", () => {
    tokenEntries.value = [
      {
        id: "t1",
        name: "вклад",
        value: "вклад ВТБ",
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    expect(restoreValuesWithCase("Выплата по ⟦вклад⟧ прошла")).toBe(
      "Выплата по вкладу ВТБ прошла",
    );
    expect(restoreValuesWithCase("⟦вклад⟧ пополнен")).toBe("вклад ВТБ пополнен");
  });

  it("неизвестный токен не теряется", () => {
    tokenEntries.value = [];
    expect(restoreValuesWithCase("о ⟦нет такого⟧")).toBe("о ⟦нет такого⟧");
  });

  it("каждому вхождению — своя форма, а не один канон", () => {
    tokenEntries.value = [
      {
        id: "t1",
        name: "я",
        value: "вклад ВТБ",
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    expect(contextForms("письмо для ⟦я⟧ и ответ к ⟦я⟧")).toEqual([
      "вклада ВТБ",
      "вкладу ВТБ",
    ]);
  });
});
