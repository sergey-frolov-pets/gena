/**
 * Раскладка кнопок композера вокруг поля ввода.
 *
 * Чистая логика вынесена из `ChatView.vue`, чтобы её можно было проверить
 * тестом без DOM. Причина существования модуля — зависание поля при переходе
 * со 2-й на 3-ю строку (см. `resolveComposerLayout`): число строк раньше
 * меряли по текущей ширине поля, а ширина поля зависит от раскладки —
 * выходил бесконечный цикл пересчётов.
 *
 * Правило Сергея (27.11.2026): одна и две строки — кнопки в ряд с каждой
 * стороны, как в однострочном поле; с трёх строк — столбцы кнопок слева
 * и справа; с четырёх сверху добавляются «Очистить» и «Свернуть». Отдельной
 * раскладки для двух строк (`pair`) больше нет: ей требовалось минимум
 * 3 строки высоты, и поле перескакивало 1 → 3, минуя две строки, а при
 * удалении так же залипало.
 */
import { COMPOSER_MAX_LINES, composerLinesForContent } from "./composer";

/** Раскладка боковых групп кнопок вокруг поля. */
export type ComposerLayout = "row" | "column";

/** Порядок перебора кандидатов: сначала ряд, затем столбец. */
export const COMPOSER_LAYOUTS: readonly ComposerLayout[] = ["row", "column"];

/** Суммарный зазор между боковыми группами и полем: gap бокса (6) + gap стороны (4). */
export const COMPOSER_SIDE_GAPS = 10;

/** Минимум строк для раскладки: ряд — с одной, столбец — с трёх. */
export const LAYOUT_MIN_LINES: Record<ComposerLayout, number> = {
  row: 1,
  column: 3,
};

/**
 * Максимум строк: в ряд влезают не больше двух строк поля (на третьей
 * кнопки уходят в столбец); у столбца верхнего предела нет — высоту
 * ограничивает только `COMPOSER_MAX_LINES` из `composer.ts`.
 */
export const LAYOUT_MAX_LINES: Record<ComposerLayout, number> = {
  row: 2,
  column: Number.POSITIVE_INFINITY,
};

/** Раскладка по числу видимых строк: 1–2 — ряд, 3 и больше — столбец. */
export function layoutForLines(lines: number): ComposerLayout {
  return lines <= LAYOUT_MAX_LINES.row ? "row" : "column";
}

/** Ширина поля, если боковые группы занимают `sideWidth` px плюс `gaps` зазоров. */
export function fieldWidthFor(boxContentWidth: number, sideWidth: number, gaps: number): number {
  return Math.max(0, boxContentWidth - sideWidth - gaps);
}

/** Входные метрики: всё, что не зависит от измеряемого текста. */
export interface ResolveComposerLayoutInput {
  /** Ширина контента контейнера композера (стабильная, не зависит от раскладки). */
  boxContentWidth: number;
  /** Суммарный зазор между боковыми группами и полем, px. */
  gaps: number;
  /** Ширина боковых групп (левой + правой) для каждой раскладки, px. */
  sideWidth: Record<ComposerLayout, number>;
  /** Высота строки поля, px. */
  lineHeight: number;
  /** Полоса прокрутки поля, px (при `scrollbar-gutter: stable` постоянна). */
  gutter?: number;
  /** Потолок строк (по умолчанию `COMPOSER_MAX_LINES`). */
  maxLines?: number;
}

/** Сигнатура набора кнопок: меняется — кеш замеренных ширин сбрасывается. */
export function composerButtonsSignature(input: {
  dictation: boolean;
  quick: boolean;
  sending: boolean;
  tall: boolean;
  collapsible: boolean;
}): string {
  const { dictation, quick, sending, tall, collapsible } = input;
  return [dictation, quick, sending, tall, collapsible].map((v) => (v ? "1" : "0")).join("");
}

/** Замер: высота содержимого текста (px) при заданной ширине поля. */
export type MeasureContentHeight = (fieldWidth: number) => number;

export interface ResolveComposerLayoutResult {
  layout: ComposerLayout;
  lines: number;
  fieldWidth: number;
}

/**
 * Выбрать раскладку и число строк по тексту.
 *
 * Неподвижная точка без итераций: для каждой раскладки ширина поля вычисляется
 * по стабильной ширине контейнера, а строки меряются уже на этой (будущей)
 * ширине. Берётся первая раскладка, в которую текст помещается по строкам.
 * Результат зависит только от текста и ширины контейнера, но не от текущей
 * раскладки, поэтому цикл «поле расширилось → текст влез в меньше строк →
 * раскладка сменилась → поле сузилось» невозможен.
 */
export function resolveComposerLayout(
  input: ResolveComposerLayoutInput,
  measure: MeasureContentHeight,
): ResolveComposerLayoutResult {
  const {
    boxContentWidth,
    gaps,
    sideWidth,
    lineHeight,
    gutter = 0,
    maxLines = COMPOSER_MAX_LINES,
  } = input;
  const line = lineHeight > 0 ? lineHeight : 20;

  const toLines = (content: number): number => {
    const guess = Math.max(1, Math.ceil(Math.max(0, content) / line - 0.1));
    return Math.min(maxLines, composerLinesForContent(content, guess, line));
  };

  for (const layout of COMPOSER_LAYOUTS) {
    const fieldWidth = fieldWidthFor(boxContentWidth, sideWidth[layout], gaps);
    const measureWidth = Math.max(0, fieldWidth - gutter);
    const lines = toLines(measure(measureWidth));
    if (lines <= LAYOUT_MAX_LINES[layout]) {
      return { layout, lines: Math.max(LAYOUT_MIN_LINES[layout], lines), fieldWidth };
    }
  }

  // Недостижимо: у столбца верхний предел безграничен.
  const layout: ComposerLayout = "column";
  const fieldWidth = fieldWidthFor(boxContentWidth, sideWidth[layout], gaps);
  const measureWidth = Math.max(0, fieldWidth - gutter);
  const lines = Math.max(LAYOUT_MIN_LINES[layout], toLines(measure(measureWidth)));
  return { layout, lines, fieldWidth };
}
