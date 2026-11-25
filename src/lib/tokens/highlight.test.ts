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

  it("открытое значение подсвечивается отдельно от токена", () => {
    const text = "перевёл вклад ВТБ вчера";
    const start = text.indexOf("вклад ВТБ");
    const parts = highlightSegments(text, false, restore, [
      { start, end: start + "вклад ВТБ".length },
    ]);
    expect(parts).toEqual([
      { text: "перевёл ", token: false },
      { text: "вклад ВТБ", token: false, offer: true },
      { text: " вчера", token: false },
    ]);
    expect(segmentsText(parts)).toBe(text);
  });
  it("пересекающиеся подсветки не наползают друг на друга", () => {
    const text = "вклад ВТБ и ещё";
    const parts = highlightSegments(text, false, restore, [
      { start: 0, end: 6 },
      { start: 3, end: 9 },
    ]);
    expect(segmentsText(parts)).toBe(text);
    expect(parts.filter((part) => part.offer).map((part) => part.text)).toEqual([
      "вклад ",
      "ВТБ",
    ]);
  });
});
