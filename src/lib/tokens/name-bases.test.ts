import { describe, expect, it } from "vitest";
import { nextBaseName, sanitizeNameBases, suggestBaseNames } from "./name-bases";

describe("name bases", () => {
  it("чистит список и сохраняет регистр", () => {
    expect(sanitizeNameBases([" ПО ", "по", "сумма", "12", ""])).toEqual(["ПО", "сумма"]);
  });

  it("номер продолжается от занятых имён", () => {
    expect(nextBaseName("компания", ["компания1", "имя1"])).toBe("компания2");
    expect(nextBaseName("ПО", [])).toBe("ПО1");
    expect(nextBaseName("модуль", ["Модуль3"])).toBe("модуль4");
  });

  it("предпочтённая основа идёт первой", () => {
    expect(suggestBaseNames(["имя", "сумма", "компания"], [], "сумма", 3)).toEqual([
      "сумма1",
      "имя1",
      "компания1",
    ]);
  });
});
