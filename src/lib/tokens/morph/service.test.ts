import { beforeEach, describe, expect, it } from "vitest";
import {
  attachMorphDictionary,
  coverageFor,
  declensionsFor,
  morphReady,
  withDeclensions,
} from "./service";
import { SAMPLE } from "./sample";

beforeEach(() => {
  attachMorphDictionary(SAMPLE, { bytes: 1024, downloadedAt: 1_700_000_000_000 });
});

describe("сервис словаря", () => {
  it("после подключения словарь считается готовым", () => {
    expect(morphReady.value).toBe(true);
  });

  it("отдаёт падежи значения", () => {
    expect(declensionsFor("вклад ВТБ")).toContain("вклада ВТБ");
    expect(declensionsFor("")).toEqual([]);
  });

  it("дописывает падежи после явных вариантов и не дублирует их", () => {
    const entries = [{ value: "вклад ВТБ", variants: ["вклада ВТБ"] }];
    const out = withDeclensions(entries);
    expect(out[0].variants?.[0]).toBe("вклада ВТБ");
    expect(out[0].variants?.filter((form) => form === "вклада ВТБ")).toHaveLength(1);
    expect(out[0].variants).toContain("вкладу ВТБ");
  });

  it("явные варианты не перекрываются словарём", () => {
    const entries = [{ value: "новый вклад", variants: ["свежего вклада"] }];
    const variants = withDeclensions(entries)[0].variants ?? [];
    expect(variants[0]).toBe("свежего вклада");
    expect(variants).toContain("нового вклада");
  });

  it("записи без падежей остаются тем же объектом", () => {
    const entries = [{ value: "1 000 ₽" }];
    expect(withDeclensions(entries)[0]).toBe(entries[0]);
  });

  it("дописывает написание без «ё»", () => {
    const entries: { value: string; variants?: string[] }[] = [{ value: "счёт" }];
    const variants = withDeclensions(entries)[0].variants ?? [];
    expect(variants).toContain("счет");
    expect(variants).toContain("счета");
  });

  it("сообщает покрытие значения", () => {
    const coverage = coverageFor("вклад озон");
    expect(coverage.covered).toBe(1);
    expect(coverage.total).toBe(2);
    expect(coverage.unknown).toEqual(["озон"]);
  });

  it("пустой список записей не ломает вызов", () => {
    const entries: { value: string; variants?: string[] }[] = [];
    expect(withDeclensions(entries)).toBe(entries);
  });
});
