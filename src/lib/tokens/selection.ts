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

/* ── Предложение имени токена ─────────────────────────────────────────── */

/** Служебные слова: из них имя токена не делаем. */
const STOP_WORDS = new Set([
  "в", "во", "на", "для", "из", "с", "со", "и", "по", "к", "ко", "у", "о", "об",
  "от", "до", "за", "под", "над", "при", "без", "про", "через", "что", "это",
  "the", "a", "an", "of", "for", "to", "in", "on", "at", "and", "or", "with",
]);

/** Имя токена: только буквы и цифры, нижний регистр, не длиннее 24 символов. */
const NAME_MAX_LEN = 24;
/** Если осмысленного слова нет — базовое имя, к нему добавится номер. */
const FALLBACK_NAME = "имя";

function cleanName(raw: string): string {
  const word = String(raw ?? "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLocaleLowerCase();
  if (!word) return "";
  // Только цифры («1200») именем не годятся: непонятно, что это за значение.
  if (!/\p{L}/u.test(word)) return "";
  return word.slice(0, NAME_MAX_LEN);
}

/** Свободное имя: занятое дополняется номером — «цена», «цена2», «цена3». */
function uniqueName(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  for (let i = 2; i < 100; i += 1) {
    const candidate = `${base}${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}${Date.now() % 1000}`;
}

/**
 * Предложить имена для нового токена из выделенного текста.
 *
 * Порядок: первое значимое слово («цена 1 200 ₽» → «цена»), второе слово,
 * затем базовое «имя». Занятые имена получают номер, поэтому в пустом
 * справочнике это «имя», а при повторе — «имя2», «имя3».
 */
export function suggestTokenNames(
  text: string,
  existing: readonly string[] = [],
  limit = 3,
): string[] {
  const words = String(text ?? "")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
  const meaningful = words.filter((word) => !STOP_WORDS.has(word.toLocaleLowerCase()));

  const used = new Set(existing.map((name) => String(name).toLocaleLowerCase()));
  const bases: string[] = [];
  for (const word of meaningful) {
    const name = cleanName(word);
    if (name && !bases.includes(name)) bases.push(name);
    if (bases.length >= 2) break;
  }
  bases.push(FALLBACK_NAME);

  const result: string[] = [];
  for (const base of bases) {
    if (result.length >= limit) break;
    const name = uniqueName(base, used);
    used.add(name);
    if (!result.includes(name)) result.push(name);
  }
  return result;
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
