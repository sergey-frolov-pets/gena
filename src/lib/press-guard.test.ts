import { describe, expect, it } from "vitest";

import { TAP_CLOSE_GUARD_MS, isPhantomTap } from "./press-guard";

describe("isPhantomTap", () => {
  it("первый тап сразу после открытия — фантомный", () => {
    expect(isPhantomTap(1000, 1010)).toBe(true);
  });

  it("тап в пределах окна — фантомный, на границе — уже нет", () => {
    expect(isPhantomTap(1000, 1000 + TAP_CLOSE_GUARD_MS - 1)).toBe(true);
    expect(isPhantomTap(1000, 1000 + TAP_CLOSE_GUARD_MS)).toBe(false);
  });

  it("осознанный тап позже — закрывает", () => {
    expect(isPhantomTap(1000, 3000)).toBe(false);
  });

  it("модалка не открывалась (openedAt = 0) — тап не считается фантомным", () => {
    expect(isPhantomTap(0, 10)).toBe(false);
  });
});
