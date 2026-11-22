import { describe, expect, it } from "vitest";
import { tokenModeActive } from "./mode-intent";

describe("tokenModeActive", () => {
  it("у открытого диалога решает флаг записи", () => {
    expect(tokenModeActive({ tokenMode: true }, false)).toBe(true);
    expect(tokenModeActive({ tokenMode: true }, true)).toBe(true);
    expect(tokenModeActive({}, true)).toBe(false);
    expect(tokenModeActive({ tokenMode: false }, true)).toBe(false);
  });

  it("без сессии (новый диалог) решает намерение", () => {
    expect(tokenModeActive(null, true)).toBe(true);
    expect(tokenModeActive(null, false)).toBe(false);
    expect(tokenModeActive(undefined, true)).toBe(true);
  });
});
