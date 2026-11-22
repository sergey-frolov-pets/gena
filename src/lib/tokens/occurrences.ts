/**
 * Вхождения значения в тексте: где именно и можно ли там заменять.
 *
 * Замена одного вхождения из плашки под полем не должна превращать текст
 * в кашу, поэтому часть вхождений блокируется:
 *  - `token` — фрагмент уже внутри токена ⟦…⟧ (менять его нечего);
 *  - `word`  — совпадение попало внутрь слова («счёт» в «расчёт»), это не
 *              отдельное значение, а часть другого слова.
 *
 * Пробелы внутри фрагмента считаются любыми пробельными: значения часто
 * приходят с неразрывными пробелами и двойными пробелами после вставки.
 */

export type OccurrenceBlock = "token" | "word";

export interface Occurrence {
  start: number;
  end: number;
  blocked?: OccurrenceBlock;
}

export interface Span {
  start: number;
  end: number;
}

export interface FindOptions {
  /** Учитывать регистр. По умолчанию регистр не важен. */
  caseSensitive?: boolean;
  /** Вернуть и заблокированные вхождения — с пометкой `blocked`. */
  includeBlocked?: boolean;
}

const TOKEN_RE = /⟦[^⟦⟧\n]{1,80}⟧/gu;

/** Диапазоны уже существующих токенов в тексте. */
export function tokenSpans(text: string): Span[] {
  const source = String(text ?? "");
  const spans: Span[] = [];
  TOKEN_RE.lastIndex = 0;
  for (let match = TOKEN_RE.exec(source); match; match = TOKEN_RE.exec(source)) {
    spans.push({ start: match.index, end: match.index + match[0].length });
  }
  return spans;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Шаблон поиска: пробелы фрагмента — любые пробельные последовательности. */
export function needlePattern(needle: string): string {
  return needle
    .trim()
    .split(/\s+/)
    .map(escapeRegExp)
    .join("\\s+");
}

function isWordChar(char: string | undefined): boolean {
  return Boolean(char) && /[\p{L}\p{N}]/u.test(char as string);
}

/** Все вхождения фрагмента: по умолчанию только те, что можно заменить. */
export function findOccurrences(
  text: string,
  needle: string,
  options: FindOptions = {},
): Occurrence[] {
  const source = String(text ?? "");
  const clean = String(needle ?? "").trim();
  if (!source || clean.length < 2) return [];

  const flags = options.caseSensitive ? "gu" : "giu";
  const re = new RegExp(needlePattern(clean), flags);
  const spans = tokenSpans(source);
  const result: Occurrence[] = [];

  for (let match = re.exec(source); match; match = re.exec(source)) {
    const start = match.index;
    const end = start + match[0].length;
    let blocked: OccurrenceBlock | undefined;
    if (spans.some((span) => start < span.end && end > span.start)) blocked = "token";
    else if (isWordChar(source[start - 1]) && isWordChar(source[start])) blocked = "word";
    else if (isWordChar(source[end]) && isWordChar(source[end - 1])) blocked = "word";

    if (!blocked || options.includeBlocked) {
      result.push(blocked ? { start, end, blocked } : { start, end });
    }
    // Пустое совпадение невозможно (фрагмент ≥ 2 символов), но защищаемся
    // от зацикливания при неожиданном шаблоне.
    if (match[0].length === 0) re.lastIndex += 1;
  }
  return result;
}

/** Заменить диапазон [start, end) и вернуть новый текст. */
export function replaceSpan(text: string, start: number, end: number, insert: string): string {
  return text.slice(0, Math.max(0, start)) + insert + text.slice(Math.max(0, end));
}

/** Заменить все вхождения фрагмента в одном тексте. */
export function replaceAllInText(
  text: string,
  needle: string,
  insert: string,
  options: FindOptions = {},
): { text: string; replaced: number } {
  const hits = findOccurrences(text, needle, options);
  if (hits.length === 0) return { text, replaced: 0 };
  let result = text;
  // С конца, чтобы не сдвигать позиции ещё не заменённых вхождений.
  for (let i = hits.length - 1; i >= 0; i -= 1) {
    result = replaceSpan(result, hits[i].start, hits[i].end, insert);
  }
  return { text: result, replaced: hits.length };
}

/** Шаг по кругу: стрелки в плашке не упираются в края. */
export function stepIndex(current: number, total: number, delta: number): number {
  if (total <= 0) return 0;
  return (((current + delta) % total) + total) % total;
}
