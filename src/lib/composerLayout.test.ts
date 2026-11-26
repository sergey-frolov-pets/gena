import { describe, expect, it } from "vitest";
import {
  COMPOSER_MAX_LINES,
  composerFieldHeight,
  composerLinesForContent,
} from "./composer";
import {
  composerButtonsSignature,
  fieldWidthFor,
  layoutForLines,
  resolveComposerLayout,
  type ResolveComposerLayoutInput,
} from "./composerLayout";

const line = 20;
const pad = 12;

/** Замер «текст шириной textPx px»: строки = ceil(textPx / width), высота = строки × line. */
function measureFor(textPx: number) {
  return (fieldWidth: number): number => {
    const safe = Math.max(1, fieldWidth);
    return Math.max(1, Math.ceil(textPx / safe)) * line;
  };
}

/** Стабильные метрики: кнопки в один ряд по бокам поля. */
function metrics(gutter = 0): ResolveComposerLayoutInput {
  return {
    boxContentWidth: 300,
    gaps: 10,
    sideWidth: { row: 220 },
    lineHeight: line,
    gutter,
  };
}

const fieldWidth = 70;
const resolve = (textPx: number, gutter = 0) =>
  resolveComposerLayout(metrics(gutter), measureFor(textPx));

describe("composerLayout: раскладка не зависит от числа строк", () => {
  it("одна строка — ряд", () => expect(layoutForLines(1)).toBe("row"));
  it("две строки — тот же ряд", () => expect(layoutForLines(2)).toBe("row"));
  it("три строки — тот же ряд", () => expect(layoutForLines(3)).toBe("row"));
  it("некорректный ввод (0) — ряд", () => expect(layoutForLines(0)).toBe("row"));
});

describe("composerLayout: ширина поля", () => {
  it("вычитает ширину боковых групп и зазоры", () => {
    expect(fieldWidthFor(300, 160, 10)).toBe(130);
  });
  it("не уходит в минус", () => {
    expect(fieldWidthFor(50, 160, 10)).toBe(0);
  });
});

describe("composerLayout: высота идёт по строке, без пропусков", () => {
  it("короткий текст — одна строка", () => {
    expect(resolve(50)).toEqual({ layout: "row", lines: 1, fieldWidth });
  });

  it("текст ровно на две строки — две строки (а не три)", () => {
    expect(resolve(2 * fieldWidth)).toEqual({ layout: "row", lines: 2, fieldWidth });
  });

  it("текст на три строки — три строки", () => {
    expect(resolve(3 * fieldWidth)).toEqual({ layout: "row", lines: 3, fieldWidth });
  });

  it("ширина поля не меняется с ростом высоты", () => {
    const widths = new Set([1, 2, 3, 4].map((n) => resolve(n * fieldWidth).fieldWidth));
    expect(widths.size).toBe(1);
  });

  it("рост и сворачивание идут по одной строке: 1 → 2 → 3 → 4 → 3 → 2 → 1", () => {
    const rows = [1, 2, 3, 4].map((n) => resolve(n * fieldWidth).lines);
    expect(rows).toEqual([1, 2, 3, 4]);
    const back = [4, 3, 2, 1].map((n) => resolve(n * fieldWidth).lines);
    expect(back).toEqual([4, 3, 2, 1]);
  });

  it("переход между строками меняет число строк максимум на одну", () => {
    let prev = resolve(1).lines;
    for (let px = 2; px <= 4 * fieldWidth; px++) {
      const now = resolve(px).lines;
      expect(Math.abs(now - prev)).toBeLessThanOrEqual(1);
      prev = now;
    }
  });

  it("больше четырёх строк — потолок, дальше прокрутка", () => {
    expect(resolve(10 * fieldWidth)).toEqual({
      layout: "row",
      lines: COMPOSER_MAX_LINES,
      fieldWidth,
    });
  });
});

describe("composerLayout: gutter (полоса прокрутки)", () => {
  it("4 строки с полосой прокрутки: высота >= содержимого", () => {
    const gutter = 8;
    const textPx = 4 * (fieldWidth - gutter);
    const res = resolve(textPx, gutter);
    expect(res.lines).toBe(4);
    const content = measureFor(textPx)(res.fieldWidth - gutter);
    expect(composerFieldHeight(res.lines, line, pad)).toBeGreaterThanOrEqual(content);
    expect(composerLinesForContent(content, 4, line)).toBe(4);
  });
});

describe("composerLayout: инвариант высоты", () => {
  it("height >= scrollHeight (допуск 1px) для текстов 1–4 строк", () => {
    for (let px = 1; px <= 4 * fieldWidth; px += 7) {
      const res = resolve(px);
      const content = measureFor(px)(res.fieldWidth);
      expect(composerFieldHeight(res.lines, line, pad) - pad).toBeGreaterThanOrEqual(content - 1);
    }
  });
});

describe("composerLayout: сигнатура кнопок", () => {
  const base = { dictation: false, quick: false, sending: false, tall: false, collapsible: false };

  it("меняется при любом флаге кнопки", () => {
    const ref = composerButtonsSignature(base);
    const keys = ["dictation", "quick", "sending", "tall", "collapsible"] as const;
    for (const k of keys) {
      expect(composerButtonsSignature({ ...base, [k]: true })).not.toBe(ref);
    }
  });

  it("одинакова при одинаковом наборе", () => {
    expect(composerButtonsSignature(base)).toBe(composerButtonsSignature(base));
  });
});
