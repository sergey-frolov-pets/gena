/**
 * Правило продукта: агент не видит настоящие значения — только токены.
 *
 * Тесты держат два свойства:
 *  1) любой текст на отправку проходит подстановку;
 *  2) контекст истории тоже чистится, включая сообщения, написанные до
 *     появления справочника или вне защищённого режима.
 */
import { afterEach, describe, expect, it } from "vitest";
import { tokenEntries, tokensBroken, tokensLoaded, type TokenEntry } from "./registry";
import { forAgent, historyForAgent, tokensReady } from "./outgoing";

const entry: TokenEntry = {
  id: "tok-1",
  name: "вклад ВТБ",
  value: "2 345 678 ₽",
  variants: ["2345678"],
  createdAt: 1,
  updatedAt: 2,
};

function withEntries(list: TokenEntry[]): void {
  tokenEntries.value = list;
  tokensLoaded.value = true;
  tokensBroken.value = 0;
}

afterEach(() => {
  tokenEntries.value = [];
  tokensLoaded.value = false;
  tokensBroken.value = 0;
});

describe("tokens/outgoing: что уходит агенту", () => {
  it("значение заменяется токеном, в тексте его больше нет", () => {
    withEntries([entry]);
    const text = forAgent("баланс 2 345 678 ₽ и 2345678 тоже");
    expect(text).toBe("баланс ⟦вклад ВТБ⟧ и ⟦вклад ВТБ⟧ тоже");
    expect(text).not.toContain("2 345 678");
  });

  it("повторный проход не портит уже стоящий токен", () => {
    withEntries([entry]);
    const once = forAgent("сумма 2 345 678 ₽");
    expect(forAgent(once)).toBe(once);
  });

  it("текст без значений не меняется", () => {
    withEntries([entry]);
    expect(forAgent("привет, как дела?")).toBe("привет, как дела?");
  });

  it("история чистится целиком — защищённый режим тут ни при чём", () => {
    withEntries([entry]);
    const list = [
      { id: "m1", content: "у меня 2 345 678 ₽", role: "user" },
      { id: "m2", content: "вижу ⟦вклад ВТБ⟧", role: "assistant" },
    ];
    const sent = historyForAgent(list);
    expect(sent.map((m) => m.content)).toEqual([
      "у меня ⟦вклад ВТБ⟧",
      "вижу ⟦вклад ВТБ⟧",
    ]);
    // Исходные записи не мутируются: в ленте значения остаются.
    expect(list[0].content).toBe("у меня 2 345 678 ₽");
  });

  it("справочник не прочитан — отправка запрещена", () => {
    expect(tokensReady()).toBe(false);
    withEntries([entry]);
    expect(tokensReady()).toBe(true);
    tokensBroken.value = 1;
    expect(tokensReady()).toBe(false);
  });
});
