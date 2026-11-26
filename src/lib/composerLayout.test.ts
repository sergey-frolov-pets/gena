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
  LAYOUT_MIN_LINES,
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

/** Метрики: контейнер 300, кнопки в ряд — 220, кнопки в столбец — 160. */
function metrics(gutter = 0): ResolveComposerLayoutInput {
  return {
    boxContentWidth: 300,
    gaps: 10,
    sideWidth: { row: 220, column: 160 },
    lineHeight: line,
    gutter,
  };
}

/** Ширина поля в ряд (300 − 220 − 10) и в столбец (300 − 160 − 10). */
const rowWidth = 70;
const columnWidth = 130;

const resolve = (textPx: number, gutter = 0) =>
  resolveComposerLayout(metrics(gutter), measureFor(textPx));

describe("composerLayout: раскладка по числу строк", () => {
  it("одна строка — кнопки в ряд", () => expect(layoutForLines(1)).toBe("row"));
  it("две строки — тоже ряд", () => expect(layoutForLines(2)).toBe("row"));
  it("три строки — столбцы кнопок", () => expect(layoutForLines(3)).toBe("column"));
  it("четыре строки — столбцы кнопок", () => expect(layoutForLines(4)).toBe("column"));
  it("некорректный ввод (0) — ряд", () => expect(layoutForLines(0)).toBe("row"));
  it("минимум строк: ряд — 1, столбец — 3", () => {
    expect(LAYOUT_MIN_LINES).toEqual({ row: 1, column: 3 });
  });
});

describe("composerLayout: ширина поля", () => {
  it("вычитает ширину боковых групп и зазоры", () => {
    expect(fieldWidthFor(300, 160, 10)).toBe(130);
  });
  it("не уходит в минус", () => {
    expect(fieldWidthFor(50, 160, 10)).toBe(0);
  });
});

describe("composerLayout: две строки не перескакивают на три", () => {
  it("текст на две строки — ровно две строки и ряд кнопок", () => {
    expect(resolve(2 * rowWidth - 2)).toEqual({
      layout: "row",
      lines: 2,
      fieldWidth: rowWidth,
    });
  });

  it("короткий текст — одна строка", () => {
    expect(resolve(30)).toEqual({ layout: "row", lines: 1, fieldWidth: rowWidth });
  });
});

describe("composerLayout: с трёх строк — столбцы", () => {
  it("третья строка включает столбцы, высота три строки", () => {
    const res = resolve(3 * rowWidth);
    expect(res.layout).toBe("column");
    expect(res.lines).toBe(3);
    expect(res.fieldWidth).toBe(columnWidth);
  });

  it("ширина постоянна внутри одной раскладки", () => {
    const widths = new Set([3, 4, 5, 6].map((n) => resolve(n * 200).fieldWidth));
    expect(widths).toEqual(new Set([columnWidth]));
  });
});

describe("composerLayout: рост и сворачивание по одной строке", () => {
  it("при наборе высота растёт: 1 → 2 → 3 → 4", () => {
    const seen: number[] = [];
    for (let px = 1; px <= 4 * columnWidth; px++) {
      const { lines } = resolve(px);
      if (seen[seen.length - 1] !== lines) seen.push(lines);
    }
    expect(seen).toEqual([1, 2, 3, 4]);
  });

  it("при удалении высота падает: 4 → 3 → 2 → 1", () => {
    const seen: number[] = [];
    for (let px = 4 * columnWidth; px >= 1; px--) {
      const { lines } = resolve(px);
      if (seen[seen.length - 1] !== lines) seen.push(lines);
    }
    expect(seen).toEqual([4, 3, 2, 1]);
  });

  it("соседние значения текста не меняют высоту больше чем на строку", () => {
    let prev = resolve(1).lines;
    for (let px = 2; px <= 4 * columnWidth; px++) {
      const now = resolve(px).lines;
      expect(Math.abs(now - prev)).toBeLessThanOrEqual(1);
      prev = now;
    }
  });

  it("больше четырёх строк — потолок, дальше прокрутка", () => {
    const res = resolve(10 * columnWidth);
    expect(res.lines).toBe(COMPOSER_MAX_LINES);
    expect(res.layout).toBe("column");
  });
});

describe("composerLayout: gutter (полоса прокрутки)", () => {
  it("4 строки с полосой прокрутки: высота >= содержимого", () => {
    const gutter = 8;
    const textPx = 4 * (columnWidth - gutter);
    const res = resolve(textPx, gutter);
    expect(res.lines).toBe(4);
    const content = measureFor(textPx)(res.fieldWidth - gutter);
    expect(composerFieldHeight(res.lines, line, pad)).toBeGreaterThanOrEqual(content);
    expect(composerLinesForContent(content, 4, line)).toBe(4);
  });
});

describe("composerLayout: инвариант высоты", () => {
  it("height >= scrollHeight (допуск 1px) для текстов 1–4 строк", () => {
    for (let px = 1; px <= 4 * columnWidth; px += 7) {
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
