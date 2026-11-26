import { describe, expect, it } from "vitest";
import {
  fieldWidthFor,
  layoutForLines,
  resolveComposerLayout,
  type ResolveComposerLayoutInput,
} from "./composerLayout";

/** Замер «текст шириной textPx px»: строки = ceil(textPx / fieldWidth), высота = строки × line. */
function measureFor(textPx: number) {
  const line = 20;
  return (fieldWidth: number): number => {
    const safe = Math.max(1, fieldWidth);
    const lines = Math.max(1, Math.ceil(textPx / safe));
    return lines * line;
  };
}

/**
 * Стабильные метрики. Поле тем шире, чем уже боковые группы:
 * row (кнопки в ряд) — самое узкое поле, column (колонки) — самое широкое.
 */
function metrics(): ResolveComposerLayoutInput {
  return {
    boxContentWidth: 300,
    gaps: 10,
    sideWidth: { row: 220, pair: 160, column: 70 },
    lineHeight: 20,
    padding: 12,
  };
}

function resolve(textPx: number) {
  return resolveComposerLayout(metrics(), measureFor(textPx));
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
    // 50 px текста влезают в одну строку даже самого узкого (row) поля.
    expect(resolve(50)).toEqual({ layout: "row", lines: 1, fieldWidth: 70 });
  });

  it("средний текст — две строки", () => {
    // 140 px: в row-поле (70) — 2 строки, в pair-поле (130) — 2 строки.
    expect(resolve(140)).toEqual({ layout: "pair", lines: 2, fieldWidth: 130 });
  });

  it("длинный текст — три строки, колонки", () => {
    // 500 px: row — 8, pair — 4, column (220) — 3 строки.
    expect(resolve(500)).toEqual({ layout: "column", lines: 3, fieldWidth: 220 });
  });

  it("регрессия 26.11.2026: текст, который на pair-ширине даёт 4 строки, а на column — 2", () => {
    // Ровно тот случай, что вешал поле: на узком (pair) поле текст требует
    // перехода в column, на широком (column) — «влезает» обратно в 2 строки.
    // Должно устойчиво оставаться column с тремя строками, а не скакать.
    const result = resolve(400);
    expect(result.layout).toBe("column");
    expect(result.lines).toBe(3);
    expect(result.fieldWidth).toBe(220);
  });

  it("текст, которому в узком row-поле нужно 2 строки, а в pair — 1, остаётся pair", () => {
    // 80 px: row (70) — 2 строки, pair (130) — 1 строка. Высота pair держится
    // в две строки, чтобы левая колонка кнопок не выпирала за рамку.
    const result = resolve(80);
    expect(result.layout).toBe("pair");
    expect(result.lines).toBe(2);
  });

  it("сверхдлинный текст упирается в COMPOSER_MAX_LINES (4)", () => {
    // Даже на самой широкой (column) раскладке текст не влезает — потолок 4.
    const result = resolve(5000);
    expect(result.layout).toBe("column");
    expect(result.lines).toBe(4);
  });

  it("результат зависит только от текста и ширины контейнера, а не от истории", () => {
    // Повторный вызов с тем же текстом даёт тот же результат — колебаний нет.
    const first = resolve(400);
    const second = resolve(400);
    expect(second).toEqual(first);
  });
});
