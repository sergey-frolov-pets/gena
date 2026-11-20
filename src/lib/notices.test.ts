import { describe, expect, it } from "vitest";
import { isTurnNotice } from "./notices";

describe("isTurnNotice", () => {
  it("плашка про таймаут модели — служебная", () => {
    expect(
      isTurnNotice(
        "⏳ Модель не ответила вовремя. Повтори сообщение — я переключусь на резервную модель.",
      ),
    ).toBe(true);
  });

  it("предупреждение и ошибка авторизации — служебные", () => {
    expect(isTurnNotice("⚠️ Не смог обработать сообщение.")).toBe(true);
    expect(isTurnNotice("🔑 Ключ API не принят.")).toBe(true);
    expect(isTurnNotice("Context window exceeded. Compressing history and retrying...")).toBe(true);
  });

  it("обычный ответ «ошибка» в тексте не считается плашкой", () => {
    expect(isTurnNotice("Ошибка в коде была в другом месте — я поправил.")).toBe(false);
    expect(isTurnNotice("Готово: тесты 143/143, сборка зелёная.")).toBe(false);
  });

  it("длинный многострочный ответ плашкой не считается", () => {
    const long = `⏳ ${"текст ".repeat(120)}\nвторая строка\nтретья\nчетвёртая`;
    expect(isTurnNotice(long)).toBe(false);
  });

  it("пустая строка — не плашка", () => {
    expect(isTurnNotice("")).toBe(false);
    expect(isTurnNotice("   ")).toBe(false);
  });
});
