import { describe, expect, it } from "vitest";
import { entriesForSession, tokenInSession, tokenIsCommon, type TokenEntry } from "./registry";

function entry(patch: Partial<TokenEntry> = {}): TokenEntry {
  return {
    id: "t1",
    name: "секрет",
    value: "привет",
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

describe("значение токена принадлежит своей сессии", () => {
  it("старая запись без сессии видна везде", () => {
    const legacy = entry();
    expect(tokenIsCommon(legacy)).toBe(true);
    expect(tokenInSession(legacy, "a")).toBe(true);
    expect(tokenInSession(legacy, null)).toBe(true);
  });

  it("токен сессии не подсвечивается в другом диалоге", () => {
    const local = entry({ sessionId: "a", shared: false });
    expect(tokenIsCommon(local)).toBe(false);
    expect(tokenInSession(local, "a")).toBe(true);
    expect(tokenInSession(local, "b")).toBe(false);
    expect(tokenInSession(local, null)).toBe(false);
  });

  it("общий токен виден в новом диалоге", () => {
    const shared = entry({ sessionId: "a", shared: true });
    expect(tokenIsCommon(shared)).toBe(true);
    expect(tokenInSession(shared, "b")).toBe(true);
    expect(entriesForSession("b", [shared, entry({ id: "t2", sessionId: "a", shared: false })])).toEqual([
      shared,
    ]);
  });
});
