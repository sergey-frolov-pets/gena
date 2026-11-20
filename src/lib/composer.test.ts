import { describe, expect, it } from "vitest";
import { isComposingKey, isNewlineKey, isSendKey, type KeyLike } from "./composer";

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
