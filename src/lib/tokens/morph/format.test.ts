import { describe, expect, it } from "vitest";
import {
  ADJ_SLOTS,
  MORPH_CASES,
  MORPH_FORMAT,
  MORPH_VERSION,
  MorphFileError,
  NOUN_SLOTS,
  parseMorphDictionary,
  readMorphJson,
  type MorphFileErrorCode,
} from "./format";
import { SAMPLE, noun } from "./sample";

function codeOf(input: unknown): MorphFileErrorCode {
  try {
    parseMorphDictionary(input);
  } catch (error) {
    if (error instanceof MorphFileError) return error.code;
    throw error;
  }
  throw new Error("ожидалась ошибка");
}

describe("формат словаря", () => {
  it("принимает корректный файл и нормализует формы", () => {
    const dict = parseMorphDictionary({
      ...SAMPLE,
      lemmas: {
        вклад: noun("m", " вклад ", "", "вкладу", null, "вкладом", "вкладе",
          "вклады", "вкладов", "вкладам", "вклады", "вкладами", "вкладах"),
      },
    });
    expect(dict.format).toBe(MORPH_FORMAT);
    expect(dict.version).toBe(MORPH_VERSION);
    expect(dict.cases).toEqual([...MORPH_CASES]);
    const entry = dict.lemmas["вклад"];
    expect(entry.p).toBe("N");
    expect(entry.f[0]).toBe("вклад");
    expect(entry.f[1]).toBeNull();
    expect(entry.f[3]).toBeNull();
  });

  it("ключи лемм приводятся к нижнему регистру", () => {
    const dict = parseMorphDictionary({
      ...SAMPLE,
      lemmas: {
        Вклад: noun("m", "вклад", "вклада", "вкладу", "вклад", "вкладом", "вкладе",
          "вклады", "вкладов", "вкладам", "вклады", "вкладами", "вкладах"),
      },
    });
    expect(Object.keys(dict.lemmas)).toEqual(["вклад"]);
  });

  it("отбрасывает чужой формат и версию", () => {
    expect(codeOf({ ...SAMPLE, format: "other" })).toBe("bad_format");
    expect(codeOf({ ...SAMPLE, version: 2 })).toBe("bad_version");
    expect(() => readMorphJson("не json")).toThrowError(MorphFileError);
    expect(codeOf([])).toBe("not_object");
  });

  it("требует ровно тот порядок падежей", () => {
    expect(codeOf({ ...SAMPLE, cases: ["gent", "nomn"] })).toBe("bad_cases");
  });

  it("ловит запись с неверным числом форм", () => {
    expect(
      codeOf({ ...SAMPLE, lemmas: { вклад: { p: "N", f: ["вклад"] } } }),
    ).toBe("bad_lemma");
    expect(
      codeOf({ ...SAMPLE, lemmas: { новый: { p: "A", f: new Array(ADJ_SLOTS - 1).fill(null) } } }),
    ).toBe("bad_lemma");
  });

  it("ловит пустой словарь и запись без части речи", () => {
    expect(codeOf({ ...SAMPLE, lemmas: {} })).toBe("empty");
    expect(
      codeOf({ ...SAMPLE, lemmas: { вклад: { p: "X", f: new Array(NOUN_SLOTS).fill(null) } } }),
    ).toBe("bad_lemma");
  });

  it("readMorphJson разбирает текст файла", () => {
    const dict = readMorphJson(JSON.stringify(SAMPLE));
    expect(Object.keys(dict.lemmas).sort()).toEqual(
      [
        "альфа-банк",
        "вклад",
        "втб",
        "деньга",
        "деньги",
        "новый",
        "сотрудник",
        "счёт",
        "улица",
      ],
    );
    expect(dict.lemmas["новый"].p).toBe("A");
  });
});
