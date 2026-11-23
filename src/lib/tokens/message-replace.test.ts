import { describe, expect, it } from "vitest";
import { replaceSelectionWithToken, replaceTokenWithValue } from "./message-replace";

describe("replaceSelectionWithToken", () => {
  it("меняет первое вхождение значения на токен", () => {
    const result = replaceSelectionWithToken("перевёл Ивану 5 000 ₽", "Ивану", "друг");
    expect(result.replaced).toBe(true);
    expect(result.text).toBe("перевёл ⟦друг⟧ 5 000 ₽");
  });

  it("пробелы во фрагменте считаются любыми", () => {
    const result = replaceSelectionWithToken("счёт 4081 7810 1", "4081\u00a07810 1", "счёт");
    expect(result.replaced).toBe(true);
    expect(result.text).toBe("счёт ⟦счёт⟧");
  });

  it("пропускает вхождение внутри слова и меняет отдельное", () => {
    const result = replaceSelectionWithToken("расчёт и счёт", "счёт", "счёт");
    expect(result.replaced).toBe(true);
    // «расчёт» — часть другого слова, менять его нельзя.
    expect(result.text).toBe("расчёт и ⟦счёт⟧");
  });

  it("не меняет ничего, если все вхождения внутри слов", () => {
    const result = replaceSelectionWithToken("расчёт по счёту", "счёт", "счёт");
    expect(result.replaced).toBe(false);
    expect(result.text).toBe("расчёт по счёту");
  });

  it("не меняет фрагмент внутри уже существующего токена", () => {
    const result = replaceSelectionWithToken("было ⟦счёт⟧", "счёт", "счёт");
    expect(result.replaced).toBe(false);
    expect(result.text).toBe("было ⟦счёт⟧");
  });

  it("возвращает исходный текст, если вхождения нет", () => {
    const result = replaceSelectionWithToken("пусто", "нечто", "имя");
    expect(result.replaced).toBe(false);
    expect(result.text).toBe("пусто");
  });

  it("пустые аргументы — без изменений", () => {
    expect(replaceSelectionWithToken("текст", "", "имя").replaced).toBe(false);
    expect(replaceSelectionWithToken("текст", "текст", "  ").replaced).toBe(false);
  });
});

describe("replaceTokenWithValue", () => {
  it("возвращает значение на место первого токена", () => {
    const result = replaceTokenWithValue("счёт ⟦счёт⟧ открыт", "счёт", "4081 7810 1");
    expect(result.replaced).toBe(true);
    expect(result.text).toBe("счёт 4081 7810 1 открыт");
  });

  it("не трогает остальные вхождения того же токена", () => {
    const result = replaceTokenWithValue("⟦имя⟧ и ⟦имя⟧", "имя", "Иван");
    expect(result.text).toBe("Иван и ⟦имя⟧");
  });

  it("возвращает текст как есть, если токена нет", () => {
    const result = replaceTokenWithValue("просто текст", "имя", "Иван");
    expect(result.replaced).toBe(false);
    expect(result.text).toBe("просто текст");
  });

  it("не подставляет пустое значение", () => {
    const result = replaceTokenWithValue("⟦имя⟧", "имя", "  ");
    expect(result.replaced).toBe(false);
    expect(result.text).toBe("⟦имя⟧");
  });
});
