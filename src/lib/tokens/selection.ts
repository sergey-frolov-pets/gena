/**
 * Выделение в поле ввода: есть ли фрагмент в справочнике и замена диапазона.
 *
 * Плашка действий живёт под полем (не всплывает у выделения). Если фрагмент
 * уже есть в справочнике — карточку с именем не показываем, только подтверждение.
 */

export interface SelectionEntry {
  id: string;
  name: string;
  value: string;
  variants?: string[];
}

/** Фрагмент для сравнения: пробелы схлопнуты, регистр не важен. */
export function normalizeFragment(text: string): string {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Запись справочника, значение или вариант которой совпадает с выделением. */
export function findSelectionEntry<T extends SelectionEntry>(
  selection: string,
  entries: readonly T[],
): T | null {
  const key = normalizeFragment(selection);
  if (key.length < 2) return null;
  for (const entry of entries) {
    const forms = [entry.value, ...(entry.variants ?? [])];
    if (forms.some((form) => normalizeFragment(form) === key)) return entry;
  }
  return null;
}

/** Заменить диапазон [start, end) и вернуть текст с позицией каретки. */
export function replaceRange(
  text: string,
  start: number,
  end: number,
  insert: string,
): { text: string; caret: number } {
  const from = Math.max(0, Math.min(start, text.length));
  const to = Math.max(from, Math.min(end, text.length));
  const next = text.slice(0, from) + insert + text.slice(to);
  return { text: next, caret: from + insert.length };
}
