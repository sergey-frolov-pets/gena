import { describe, expect, it } from "vitest";
import {
  countTokens,
  formatToken,
  isValidTokenName,
  normalizeTokenForms,
  normalizeTokenName,
  parseTokens,
  tokenNameKey,
  tokensToValues,
} from "./format";

describe("tokens/format", () => {
  it("канонический токен — ⟦имя⟧", () => {
    expect(formatToken("вклад ВТБ")).toBe("⟦вклад ВТБ⟧");
  });

  it("[[…]] и {{…}} приводятся к канону", () => {
    expect(normalizeTokenForms("заплатил [[вклад ВТБ]] и {{аренда}}")).toBe(
      "заплатил ⟦вклад ВТБ⟧ и ⟦аренда⟧",
    );
  });

  it("канонические токены повторной нормализацией не портятся", () => {
    const text = "⟦вклад ВТБ⟧";
    expect(normalizeTokenForms(text)).toBe(text);
  });

  it("имя чистится от скобок и лишних пробелов", () => {
    expect(normalizeTokenName("  [[  вклад   ВТБ ]]  ")).toBe("вклад ВТБ");
  });

  it("имя не может быть пустым или со скобками внутри", () => {
    expect(isValidTokenName("")).toBe(false);
    expect(isValidTokenName("   ")).toBe(false);
    expect(isValidTokenName("a[б]")).toBe(false);
    expect(isValidTokenName("вклад ВТБ")).toBe(true);
  });

  it("ключ имени не зависит от регистра", () => {
    expect(tokenNameKey("Вклад ВТБ")).toBe(tokenNameKey("вклад втб"));
  });

  it("разбирает несколько токенов и считает их", () => {
    const text = "⟦a⟧ и ещё ⟦b c⟧, плюс ⟦a⟧";
    expect(parseTokens(text).map((token) => token.name)).toEqual(["a", "b c", "a"]);
    expect(countTokens(text)).toBe(3);
  });

  it("незакрытый токен не считается токеном", () => {
    expect(parseTokens("⟦незакрытый")).toEqual([]);
  });

  it("токены заменяются значениями, неизвестные остаются как есть", () => {
    const lookup = (name: string) => (name === "вклад ВТБ" ? "1 234 567 ₽" : undefined);
    expect(tokensToValues("баланс ⟦вклад ВТБ⟧ и ⟦нет такого⟧", lookup)).toBe(
      "баланс 1 234 567 ₽ и ⟦нет такого⟧",
    );
  });

  it("текст без токенов возвращается как есть", () => {
    expect(tokensToValues("обычный текст", () => "x")).toBe("обычный текст");
  });
});
