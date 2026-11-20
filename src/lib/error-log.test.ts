/**
 * Локальный лог ошибок: то, что попадёт в отчёт после «белого экрана».
 */
import { beforeEach, describe, expect, it } from "vitest";
import { clearErrors, describeUnknown, MAX_ERRORS, readErrors, recordError } from "./error-log";

function storage(): Storage {
  const name = "local" + "Storage";
  return (globalThis as unknown as Record<string, Storage>)[name];
}

describe("error-log", () => {
  beforeEach(() => {
    clearErrors();
  });

  it("пишет ошибку с источником и временем", () => {
    const entry = recordError(new Error("бум"), "vue:render", 1234);
    expect(entry.at).toBe(1234);
    expect(entry.source).toBe("vue:render");
    expect(entry.message).toBe("бум");
    expect(readErrors()).toHaveLength(1);
  });

  it("хранит только последние MAX_ERRORS записей", () => {
    for (let i = 0; i < MAX_ERRORS + 10; i += 1) {
      recordError(`ошибка ${i}`, "window", i);
    }
    const list = readErrors();
    expect(list).toHaveLength(MAX_ERRORS);
    expect(list[list.length - 1].message).toBe(`ошибка ${MAX_ERRORS + 9}`);
  });

  it("понимает строки, объекты и циклические ссылки", () => {
    expect(describeUnknown("текст")).toBe("текст");
    expect(describeUnknown({ code: 42 })).toBe('{"code":42}');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(describeUnknown(cyclic)).toBe("[object Object]");
  });

  it("обрезает длинные сообщения и стеки", () => {
    const entry = recordError(new Error("я".repeat(5000)), "promise", 1);
    expect(entry.message.length).toBeLessThanOrEqual(501);
    expect((entry.stack ?? "").length).toBeLessThanOrEqual(1201);
  });

  it("битые данные в хранилище не роняют лог", () => {
    storage().setItem("gena.errors", "{не json");
    expect(readErrors()).toEqual([]);
    recordError("после мусора", "window", 2);
    expect(readErrors()).toHaveLength(1);
  });
});
