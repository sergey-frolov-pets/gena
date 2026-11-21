import { describe, expect, it } from "vitest";
import {
  COMPOSER_MAX_LINES,
  composerFieldHeight,
  isComposingKey,
  isNewlineKey,
  isSendKey,
  type KeyLike,
} from "./composer";

/** Минимальное событие клавиатуры для проверки правил. */
function key(overrides: Partial<KeyLike> = {}): KeyLike {
  return { key: "Enter", ...overrides };
}

describe("composer: клавиши отправки", () => {
  it("Shift+Enter отправляет (решение Сергея 20.11.2026)", () => {
    expect(isSendKey(key({ shiftKey: true }))).toBe(true);
  });

  it("Ctrl+Enter и Cmd+Enter отправляют", () => {
    expect(isSendKey(key({ ctrlKey: true }))).toBe(true);
    expect(isSendKey(key({ metaKey: true }))).toBe(true);
  });

  it("простой Enter — не отправка, а новая строка", () => {
    const plain = key();
    expect(isSendKey(plain)).toBe(false);
    expect(isNewlineKey(plain)).toBe(true);
  });

  it("Enter во время IME-ввода не отправляет", () => {
    expect(isComposingKey(key({ isComposing: true }))).toBe(true);
    expect(isSendKey(key({ shiftKey: true, isComposing: true }))).toBe(false);
    expect(isSendKey(key({ ctrlKey: true, keyCode: 229 }))).toBe(false);
    expect(isNewlineKey(key({ isComposing: true }))).toBe(false);
  });

  it("не Enter не считается отправкой, даже со Shift", () => {
    expect(isSendKey(key({ key: "a", shiftKey: true }))).toBe(false);
    expect(isSendKey(key({ key: "Escape" }))).toBe(false);
    expect(isNewlineKey(key({ key: "Escape" }))).toBe(false);
  });
});

describe("composer: высота поля ввода", () => {
  const line = 20;
  const pad = 12;

  it("одна строка — минимальная высота как есть", () => {
    expect(composerFieldHeight(1, line, pad)).toBe(line + pad);
  });

  it("две строки и больше — не ниже двух строк (решение Сергея 21.11.2026)", () => {
    expect(composerFieldHeight(2, line, pad)).toBe(2 * line + pad);
    expect(composerFieldHeight(3, line, pad)).toBe(3 * line + pad);
  });

  it("рост ограничен четырьмя строками — дальше скролл", () => {
    expect(composerFieldHeight(9, line, pad)).toBe(COMPOSER_MAX_LINES * line + pad);
  });

  it("мусорный замер не ломает высоту", () => {
    expect(composerFieldHeight(0, line, pad)).toBe(line + pad);
    expect(composerFieldHeight(Number.NaN, line, pad)).toBe(line + pad);
    expect(composerFieldHeight(1.4, line, pad)).toBe(line + pad);
  });

  it("без line-height и padding не падает в ноль", () => {
    expect(composerFieldHeight(2, 0, 0)).toBe(2 * 20);
  });
});
