import { describe, expect, it } from "vitest";
import {
  composerButtonsSignature,
  fieldWidthFor,
  layoutForLines,
  resolveComposerLayout,
  type ResolveComposerLayoutInput,
} from "./composerLayout";
import { composerFieldHeight } from "./composer";

const line = 20;

/** Замер «текст шириной textPx px»: строки = ceil(textPx / width), высота = строки × line. */
function measureFor(textPx: number) {
  return (fieldWidth: number): number => {
    const safe = Math.max(1, fieldWidth);
    return Math.max(1, Math.ceil(textPx / safe)) * line;
  };
}

/**
 * Стабильные метрики. Поле тем шире, чем уже боковые группы:
 * row (кнопки в ряд) — самое узкое поле, column (колонки) — самое широкое.
 */
function metrics(gutter = 0): ResolveComposerLayoutInput {
  return {
    boxContentWidth: 300,
    gaps: 10,
    sideWidth: { row: 220, pair: 160, column: 70 },
    lineHeight: line,
    gutter,
  };
}

function resolve(textPx: number, gutter = 0) {
  return resolveComposerLayout(metrics(gutter), measureFor(textPx));
}

describe("composerLayout: раскладка по числу строк", () => {
  it("одна строка — ряд", () => expect(layoutForLines(1)).toBe("row"));
  it("две строки — левая колонка + правый ряд", () => expect(layoutForLines(2)).toBe("pair"));
  it("три и больше — колонки с обеих сторон", () => expect(layoutForLines(3)).toBe("column"));
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

describe("composerLayout: выбор раскладки без колебаний", () => {
  it("короткий текст — одна строка, кнопки в ряд", () => {
    expect(resolve(50)).toEqual({ layout: "row", lines: 1, fieldWidth: 70 });
  });

  it("средний текст — две строки", () => {
    expect(resolve(140)).toEqual({ layout: "pair", lines: 2, fieldWidth: 130 });
  });

  it("длинный текст — три строки, колонки", () => {
    expect(resolve(500)).toEqual({ layout: "column", lines: 3, fieldWidth: 220 });
  });

  it("регрессия 26.11.2026: 4 строки на pair-ширине, 2 на column — устойчиво column", () => {
    const result = resolve(400);
    expect(result.layout).toBe("column");
    expect(result.lines).toBe(3);
    expect(result.fieldWidth).toBe(220);
  });

  it("row→pair→column монотонно, без возвратов на соседних символах", () => {
    const order = ["row", "pair", "column"];
    let seen = -1;
    for (let px = 1; px <= 700; px++) {
      const idx = order.indexOf(resolve(px).layout);
      expect(idx).toBeGreaterThanOrEqual(seen);
      seen = idx;
    }
  });
});

describe("composerLayout: gutter (полоса прокрутки)", () => {
  it("3→4 без ручной высоты: gutter учтён, lines=4, height >= content", () => {
    const gutter = 8;
    // ровно 4 строки в column-поле после вычета полосы прокрутки
    const textPx = 4 * (220 - gutter);
    const res = resolve(textPx, gutter);
    expect(res.layout).toBe("column");
    expect(res.lines).toBe(4);
    const content = measureFor(textPx)(res.fieldWidth - gutter);
    expect(composerFieldHeight(res.lines, line, 12)).toBeGreaterThanOrEqual(content);
  });
});

describe("composerLayout: инвариант высоты", () => {
  it("height >= scrollHeight (с допуском 1px на округление) для текстов 1–4 строк", () => {
    for (let px = 1; px <= 4 * 220; px += 13) {
      const res = resolve(px);
      const content = measureFor(px)(res.fieldWidth);
      // высота = lines*line + padding; scrollHeight = content + padding.
      expect(composerFieldHeight(res.lines, line, 12) - 12).toBeGreaterThanOrEqual(content - 1);
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
    expect(composerButtonsSignature(base)).toBe(composerButtonsSignature({ ...base }));
  });
});
