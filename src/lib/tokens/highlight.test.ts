import { describe, expect, it } from "vitest";

import { highlightSegments, segmentsText } from "./highlight";

const restore = (token: string) => token.replace(/⟦вклад⟧/gu, "вклад ВТБ");

describe("highlightSegments", () => {
  it("текст без токенов — один обычный кусок", () => {
    expect(highlightSegments("просто текст", false, restore)).toEqual([
      { text: "просто текст", token: false },
    ]);
  });

  it("токены показываются как есть", () => {
    const parts = highlightSegments("перевёл ⟦вклад⟧ вчера", false, restore);
    expect(parts).toEqual([
      { text: "перевёл ", token: false },
      { text: "⟦вклад⟧", token: true },
      { text: " вчера", token: false },
    ]);
    expect(segmentsText(parts)).toBe("перевёл ⟦вклад⟧ вчера");
  });

  it("в режиме значений подсвечен расшифрованный кусок", () => {
    const parts = highlightSegments("перевёл ⟦вклад⟧ вчера", true, restore);
    expect(parts).toEqual([
      { text: "перевёл ", token: false },
      { text: "вклад ВТБ", token: true },
      { text: " вчера", token: false },
    ]);
    expect(segmentsText(parts)).toBe("перевёл вклад ВТБ вчера");
  });

  it("незакрытый токен — обычный текст", () => {
    const parts = highlightSegments("⟦вклад и всё", false, restore);
    expect(parts.some((part) => part.token)).toBe(false);
  });

  it("токен вплотную к краям", () => {
    expect(highlightSegments("⟦вклад⟧", false, restore)).toEqual([
      { text: "⟦вклад⟧", token: true },
    ]);
  });

  it("пустой текст — пустой список", () => {
    expect(highlightSegments("", false, restore)).toEqual([]);
  });
});
