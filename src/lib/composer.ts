/**
 * Клавиатура композера. Правило Сергея (20.11.2026):
 * Shift+Enter и Ctrl/Cmd+Enter — отправить, простой Enter — новая строка.
 * Логика вынесена из `.vue`, чтобы её можно было проверить тестом.
 */

/** Минимум полей события клавиатуры, который нам нужен (тестируется без DOM). */
export interface KeyLike {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
}

/** Идёт ввод через IME (китайский/японский): Enter выбирает иероглиф, а не шлёт. */
export function isComposingKey(event: KeyLike): boolean {
  return event.isComposing === true || event.keyCode === 229 || event.key === "Process";
}

/** Enter с Shift / Ctrl / Cmd — отправить реплику. */
export function isSendKey(event: KeyLike): boolean {
  if (event.key !== "Enter") return false;
  if (isComposingKey(event)) return false;
  return event.shiftKey === true || event.ctrlKey === true || event.metaKey === true;
}

/** Простой Enter — перенос строки (поведение textarea по умолчанию). */
export function isNewlineKey(event: KeyLike): boolean {
  if (event.key !== "Enter") return false;
  if (isComposingKey(event)) return false;
  return !isSendKey(event);
}

/** Сколько строк максимум растягивается поле ввода. */
export const COMPOSER_MAX_LINES = 4;

/**
 * Высота поля ввода в пикселях по замеренному числу строк.
 * `lineHeight` и `padding` — из computed style (box-sizing: border-box).
 * Высота всегда равна числу строк: удалил перенос — поле сжалось обратно
 * до одной строки (правило Сергея 26.11.2026, отменяет минимум в две строки
 * от 21.11.2026). Потолок — 4 строки, дальше скролл.
 */
export function composerFieldHeight(
  measuredLines: number,
  lineHeight: number,
  padding: number,
): number {
  const line = lineHeight > 0 ? lineHeight : 20;
  const pad = padding > 0 ? padding : 0;
  const raw = Number.isFinite(measuredLines) ? Math.round(measuredLines) : 1;
  const lines = Math.max(1, raw);
  return Math.min(lines, COMPOSER_MAX_LINES) * line + pad;
}

/**
 * Сколько строк реально нужно для измеренной высоты текста.
 *
 * `content` — высота содержимого (замер по скрытому зеркалу, без схлопывания
 * поля), `guess` — верхняя оценка в строках. Запас в пиксель нужен, потому что
 * `scrollHeight` округляется до целого и дробная line-height иначе не даёт
 * сжать поле. Верхняя граница — `COMPOSER_MAX_LINES`.
 */
export function composerLinesForContent(
  content: number,
  guess: number,
  lineHeight: number,
): number {
  const guessLines = Number.isFinite(guess) ? Math.round(guess) : 1;
  let lines = Math.min(COMPOSER_MAX_LINES, Math.max(1, guessLines));
  const height = Number.isFinite(content) ? Math.max(0, content) : 0;
  const line = lineHeight > 0 ? lineHeight : 20;
  // Сжимаем, пока текст реально помещается в (lines-1) строк. Сравниваем высоту
  // текста с высотой (lines-1) строк БЕЗ паддинга: паддинг — не место для текста,
  // иначе на границе строки поле оставалось на строку ниже нужного (верх обрезался).
  // Запас в 1px — компенсация округления scrollHeight до целого.
  while (lines > 1) {
    if (height > (lines - 1) * line + 1) break;
    lines -= 1;
  }
  return lines;
}
