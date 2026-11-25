import { describe, expect, it } from "vitest";

import { placeBubble } from "./caret-point";

const base = {
  lineHeight: 20,
  bubbleWidth: 80,
  bubbleHeight: 26,
  boxWidth: 300,
};

describe("placeBubble", () => {
  it("ставит облачко над словом по центру", () => {
    const result = placeBubble({ ...base, wordLeft: 150, wordTop: 60 });
    expect(result.left).toBe(110);
    expect(result.top).toBe(60 - 26 - 6);
    expect(result.below).toBe(false);
  });

  it("не вылезает за правый край поля", () => {
    const result = placeBubble({ ...base, wordLeft: 295, wordTop: 60 });
    expect(result.left).toBe(300 - 80 - 4);
  });

  it("не вылезает за левый край поля", () => {
    const result = placeBubble({ ...base, wordLeft: 10, wordTop: 60 });
    expect(result.left).toBe(4);
  });

  it("первая строка — облачко под словом", () => {
    const result = placeBubble({ ...base, wordLeft: 150, wordTop: 2 });
    expect(result.below).toBe(true);
    expect(result.top).toBe(2 + 20 + 6);
  });

  it("узкое поле: облачко прижимается к левому краю", () => {
    const result = placeBubble({
      ...base,
      boxWidth: 60,
      bubbleWidth: 80,
      wordLeft: 30,
      wordTop: 40,
    });
    expect(result.left).toBe(4);
  });
});
