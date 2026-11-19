/**
 * Проверка целостности словарей i18n.
 *
 * Английский словарь — источник истины. Каждый другой язык обязан
 * покрывать все его ключи и не содержать лишних.
 */

import { describe, expect, it } from "vitest";
import { messagesByLocale } from "./messages";
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, localeDirection } from "./constants";
import { translateForLocale } from "./index";

const baseKeys = Object.keys(messagesByLocale[DEFAULT_LOCALE]).sort();

describe("i18n словари", () => {
  it("английский словарь не пуст", () => {
    expect(baseKeys.length).toBeGreaterThan(50);
  });

  for (const locale of SUPPORTED_LOCALES) {
    it(`${locale}: покрывает все ключи английского`, () => {
      const keys = Object.keys(messagesByLocale[locale]).sort();
      const missing = baseKeys.filter((k) => !keys.includes(k));
      const extra = keys.filter((k) => !baseKeys.includes(k));
      expect(missing, `не хватает ключей в ${locale}`).toEqual([]);
      expect(extra, `лишние ключи в ${locale}`).toEqual([]);
    });
  }

  it("арабский — RTL, остальные — LTR", () => {
    expect(localeDirection("ar")).toBe("rtl");
    expect(localeDirection("en")).toBe("ltr");
    expect(localeDirection("ru")).toBe("ltr");
  });

  it("подстановка параметров", () => {
    expect(translateForLocale("en", "chat.usage", { used: 3, limit: 10 })).toBe(
      "3 / 10 calls today",
    );
  });

  it("неизвестный ключ возвращается как есть", () => {
    // Проверяем fallback-ветку: ключа нет ни в одном словаре.
    const key = "errors.status.other";
    expect(translateForLocale("de", key, { status: 418 })).toContain("418");
  });
});
