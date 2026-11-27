import { describe, expect, it } from "vitest";

import { canRenameSession, normalizeSessionName } from "./session-name";

describe("normalizeSessionName", () => {
  it("убирает пробелы по краям", () => {
    expect(normalizeSessionName("  Поездка в Терскол  ")).toBe("Поездка в Терскол");
  });

  it("схлопывает повторные пробелы и переводы строк", () => {
    expect(normalizeSessionName("Поездка   в\nТерскол")).toBe("Поездка в Терскол");
  });

  it("пустая строка остаётся пустой", () => {
    expect(normalizeSessionName("   ")).toBe("");
  });
});

describe("canRenameSession", () => {
  it("изменённое название можно сохранить", () => {
    expect(canRenameSession("Новое имя", "Старое имя")).toBe(true);
  });

  it("пустое название сохранить нельзя", () => {
    expect(canRenameSession("", "Старое имя")).toBe(false);
    expect(canRenameSession("   ", "Старое имя")).toBe(false);
  });

  it("неизменённое название — кнопка неактивна", () => {
    expect(canRenameSession("Старое имя", "Старое имя")).toBe(false);
  });

  it("разница только в пробелах — это не изменение", () => {
    expect(canRenameSession("  Старое   имя ", "Старое имя")).toBe(false);
  });
});

describe("длинное название", () => {
  it("сохраняется целиком, без обрезки", () => {
    const long = "Планёрка по квартальному планированию и бюджету на следующий год";
    expect(normalizeSessionName(`  ${long}\n`)).toBe(long);
    expect(canRenameSession(long, "Старое имя")).toBe(true);
  });

  it("перевод строки из многострочного поля не ломает сравнение", () => {
    expect(canRenameSession("Старое имя\n", "Старое имя")).toBe(false);
  });
});
