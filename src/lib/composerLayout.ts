/**
 * Раскладка кнопок композера вокруг поля ввода.
 *
 * Чистая логика вынесена из `ChatView.vue`, чтобы её можно было проверить
 * тестом без DOM. Причина существования модуля — зависание поля при переходе
 * со 2-й на 3-ю строку (см. `resolveComposerLayout`): число строк раньше
 * меряли по текущей ширине поля, а ширина поля зависит от раскладки —
 * выходил бесконечный цикл пересчётов.
 *
 * Правило Сергея (26.11.2026): одна строка — кнопки в ряд с каждой стороны,
 * две — левая колонка + правый ряд, три и больше — колонка с каждой стороны.
 */
import { COMPOSER_MAX_LINES, composerLinesForContent } from "./composer";

/** Раскладка боковых групп кнопок вокруг поля. */
export type ComposerLayout = "row" | "pair" | "column";

/** Порядок перебора кандидатов: от самой узкой к самой широкой раскладке. */
export const COMPOSER_LAYOUTS: readonly ComposerLayout[] = ["row", "pair", "column"];

/** Суммарный зазор между боковыми группами и полем: gap бокса (6) + gap стороны (4). */
export const COMPOSER_SIDE_GAPS = 10;

/**
 * Минимум строк для раскладки. Колонки кнопок (левая в `pair`, обе в `column`)
 * выше одной строки, поэтому высоту поля нельзя сделать меньше, иначе колонка
 * выпирает за рамку.
 */
export const LAYOUT_MIN_LINES: Record<ComposerLayout, number> = {
  row: 1,
  pair: 2,
  column: 3,
};

/** Максимум строк, при котором раскладка ещё корректна (column безгранична). */
export const LAYOUT_MAX_LINES: Record<ComposerLayout, number> = {
  row: 1,
  pair: 2,
  column: Number.POSITIVE_INFINITY,
};

/** Раскладка по числу видимых строк. */
export function layoutForLines(lines: number): ComposerLayout {
  if (lines <= 1) return "row";
  if (lines <= 2) return "pair";
  return "column";
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
  /** Высота одной строки поля, px. */
  lineHeight: number;
  /** Резерв под полосу прокрутки (`scrollbar-gutter`), px. Контентная ширина
   *  поля для переноса меньше его полной ширины на эту величину. */
  gutter: number;
  /** Верхний предел строк (по умолчанию `COMPOSER_MAX_LINES`). */
  maxLines?: number;
}

/** Видимость кнопок, меняющих ширину боковых групп. */
export interface ComposerButtonsSignature {
  dictation: boolean;
  quick: boolean;
  sending: boolean;
  tall: boolean;
  collapsible: boolean;
}

/** Ключ набора кнопок: меняется при изменении любого флага — по нему сбрасываем кеш ширин. */
export function composerButtonsSignature(input: ComposerButtonsSignature): string {
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

  // Недостижимо: у `column` верхний предел безграничен, итерация всегда сходится.
  const layout: ComposerLayout = "column";
  const fieldWidth = fieldWidthFor(boxContentWidth, sideWidth[layout], gaps);
  const measureWidth = Math.max(0, fieldWidth - gutter);
  const lines = Math.max(LAYOUT_MIN_LINES[layout], toLines(measure(measureWidth)));
  return { layout, lines, fieldWidth };
}
