import { describe, expect, it } from "vitest";
import { buildMorphIndex, caseVariants } from "./analyze";
import { SAMPLE } from "./sample";

const index = buildMorphIndex(SAMPLE);

describe("индекс словоформ", () => {
  it("находит лемму и падеж по форме", () => {
    const parses = index.lookup("вклада") ?? [];
    expect(parses.some((item) => item.lemma === "вклад" && item.caseIndex === 1 && !item.plural)).toBe(true);
  });

  it("не различает регистр", () => {
    expect(index.lookup("ВКЛАДОМ")?.length).toBeGreaterThan(0);
  });

  it("находит слова с «е» вместо «ё»", () => {
    const parses = index.lookup("счета") ?? [];
    expect(parses.some((item) => item.lemma === "счёт")).toBe(true);
  });

  it("считает леммы и формы", () => {
    expect(index.lemmaCount).toBe(9);
    expect(index.formCount).toBeGreaterThan(20);
  });
});

describe("падежи значения", () => {
  it("склоняет существительное с неизменяемым приложением", () => {
    const result = caseVariants("вклад ВТБ", index);
    expect(result.variants).toContain("вклада ВТБ");
    expect(result.variants).toContain("вкладу ВТБ");
    expect(result.variants).toContain("вкладе ВТБ");
    expect(result.variants).toContain("вкладами ВТБ");
    // «ВТБ» — имя собственное после первого слова: не склоняем и не считаем.
    expect(result.covered).toBe(1);
    expect(result.total).toBe(1);
    expect(result.unknown).toEqual([]);
  });

  it("сохраняет регистр исходного текста", () => {
    const result = caseVariants("Вклад ВТБ", index);
    expect(result.variants).toContain("Вклада ВТБ");
    expect(result.variants).not.toContain("вклада ВТБ");
  });

  it("согласует прилагательное с родом ведущего слова", () => {
    const masculine = caseVariants("новый вклад", index).variants;
    expect(masculine).toContain("нового вклада");
    expect(masculine).toContain("новым вкладом");

    const feminine = caseVariants("новая улица", index).variants;
    expect(feminine).toContain("новой улицы");
    expect(feminine).toContain("новую улицу");
  });

  it("не даёт вариантов для неизменяемого слова", () => {
    expect(caseVariants("ВТБ", index).variants).toEqual([]);
  });

  it("не даёт вариантов для чисел", () => {
    expect(caseVariants("1 234 567 ₽", index).variants).toEqual([]);
    expect(caseVariants("1 234 567 ₽", index).unknown).toEqual([]);
  });

  it("оставляет незнакомое слово как есть и сообщает о нём", () => {
    const result = caseVariants("вклад озон", index);
    expect(result.variants).toContain("вклада озон");
    expect(result.covered).toBe(1);
    expect(result.total).toBe(2);
    expect(result.unknown).toEqual(["озон"]);
  });

  it("не склоняет имя собственное после первого слова", () => {
    const result = caseVariants("улица Ленина", index);
    expect(result.variants).toContain("улицы Ленина");
    expect(result.variants).toContain("улицей Ленина");
    expect(result.variants.some((form) => form.includes("Ленину"))).toBe(false);
    expect(result.variants.some((form) => form.includes("Лениным"))).toBe(false);
  });

  it("не склоняет слова после предлога", () => {
    const result = caseVariants("вклад ВТБ в Альфа-Банке", index);
    expect(result.variants).toContain("вклада ВТБ в Альфа-Банке");
    expect(result.variants).toContain("вкладом ВТБ в Альфа-Банке");
    expect(result.variants.some((form) => form.includes("Альфа-Банка"))).toBe(false);
  });

  it("переносит регистр дефисных частей", () => {
    const result = caseVariants("Альфа-Банк", index);
    expect(result.variants).toContain("Альфа-Банка");
    expect(result.variants).toContain("Альфа-Банку");
  });

  it("винительный неодушевлённого мужского не подменяет прилагательное", () => {
    const variants = caseVariants("новый вклад", index).variants;
    expect(variants).not.toContain("нового вклад");
    expect(variants).toContain("нового вклада");
  });

  it("винительный одушевлённого мужского склоняет прилагательное", () => {
    const variants = caseVariants("новый сотрудник", index).variants;
    expect(variants).toContain("нового сотрудника");
  });

  it("пропускает падежи с дефектной парадигмой, а не выдумывает формы", () => {
    const result = caseVariants("деньги", index);
    expect(result.variants).toContain("денег");
    expect(result.variants).toContain("деньгами");
    expect(result.variants).not.toContain("деньга");
    expect(result.variants.every((form) => !form.includes("null"))).toBe(true);
  });

  it("из множественного числа единственное не строит", () => {
    const variants = caseVariants("деньги", index).variants;
    expect(variants).toContain("денег");
    expect(variants).toContain("деньгами");
    expect(variants).not.toContain("деньгой");
    expect(variants).not.toContain("деньгу");
  });

  it("без словаря вариантов нет", () => {
    expect(caseVariants("вклад ВТБ", null).variants).toEqual([]);
  });

  it("не повторяет исходное написание и дубли", () => {
    const variants = caseVariants("вклад", index).variants;
    expect(variants).not.toContain("вклад");
    expect(new Set(variants.map((form) => form.toLowerCase())).size).toBe(variants.length);
  });

  it("сохраняет разделители значения", () => {
    const result = caseVariants("вклад — ВТБ", index);
    expect(result.variants).toContain("вклада — ВТБ");
  });
});
