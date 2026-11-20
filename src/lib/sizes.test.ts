import { describe, expect, it } from "vitest";
import { formatSize, recordBytes } from "./sizes";

describe("formatSize", () => {
  it("байты — целым числом", () => {
    expect(formatSize(0)).toBe("0 Б");
    expect(formatSize(1)).toBe("1 Б");
    expect(formatSize(840)).toBe("840 Б");
    expect(formatSize(1023)).toBe("1023 Б");
  });

  it("килобайты, мегабайты, гигабайты — один знак после запятой", () => {
    expect(formatSize(1024)).toBe("1,0 КБ");
    expect(formatSize(2048)).toBe("2,0 КБ");
    expect(formatSize(12_800)).toBe("12,5 КБ");
    expect(formatSize(1024 * 1024)).toBe("1,0 МБ");
    expect(formatSize(Math.round(1.2 * 1024 * 1024))).toBe("1,2 МБ");
    expect(formatSize(1024 ** 3)).toBe("1,0 ГБ");
    expect(formatSize(1.3 * 1024 ** 3)).toBe("1,3 ГБ");
  });

  it("учитывает локаль для разделителя", () => {
    expect(formatSize(12_800, "en")).toBe("12.5 КБ");
  });

  it("не падает на мусоре", () => {
    expect(formatSize(Number.NaN)).toBe("0 Б");
    expect(formatSize(-5)).toBe("0 Б");
  });
});

describe("recordBytes", () => {
  it("считает JSON в байтах UTF-8", () => {
    expect(recordBytes({ a: 1 })).toBe(7);
    // Кириллица в UTF-8 — 2 байта на символ.
    expect(recordBytes("я")).toBe(4);
  });

  it("пустые значения — 0", () => {
    expect(recordBytes(undefined)).toBe(0);
  });
});
