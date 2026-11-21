import { describe, expect, it } from "vitest";
import { toCsv, toTsv, toXlsx } from "./table-file";

describe("table-file", () => {
  const rows = [
    ["a", "b"],
    ["1,2", 'say "hi"'],
  ];

  it("csv экранирует запятые и кавычки", () => {
    expect(toCsv(rows)).toBe('a,b\r\n"1,2","say ""hi"""');
  });

  it("tsv склеивает ячейки табуляцией", () => {
    expect(toTsv([["a", "b"], ["1", "2"]])).toBe("a\tb\n1\t2");
  });

  it("xlsx — zip без сжатия с текстом ячеек", () => {
    const bytes = toXlsx(rows);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("sheet1.xml");
    expect(text).toContain("1,2");
    expect(text).toContain('say "hi"');
    expect(text).toContain('r="B2"');
  });
});
