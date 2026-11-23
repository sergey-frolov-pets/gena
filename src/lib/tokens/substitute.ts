/**
 * Движок подстановки: значения справочника ↔ токены.
 *
 * Что умеет:
 *  - значения из нескольких слов («вклад ВТБ в Альфа-Банке»);
 *  - разные написания одного значения — падежи, сокращения, обратный порядок
 *    слов — задаются в `variants` записи, поэтому морфология здесь не гадает;
 *  - регистр по умолчанию не важен, но запись может попросить обратное:
 *    `caseSensitive: true` — тогда «ВТБ» и «втб» для неё разные написания;
 *    флаг живёт в токене, а не в диалоге и не в серии замен;
 *  - самое длинное совпадение выигрывает, уже стоящие токены не оборачиваются
 *    повторно — повторный проход идемпотентен.
 */

import {
  TOKEN_CLOSE,
  TOKEN_OPEN,
  formatToken,
  normalizeTokenForms,
  parseTokens,
} from "./format";

export interface TokenSource {
  name: string;
  value: string;
  variants?: string[];
  /** Учитывать регистр при поиске написаний этой записи. */
  caseSensitive?: boolean;
}

export interface SubstitutionResult {
  text: string;
  /** Сколько вхождений заменили — для счётчика в интерфейсе. */
  hits: number;
}

interface Needle {
  /** Написание в исходном регистре. */
  raw: string;
  /** Приведённое к нижнему регистру — для поиска без учёта регистра. */
  needle: string;
  name: string;
  caseSensitive: boolean;
}

const WORD = /[\p{L}\p{N}_]/u;

/** Минимальная длина значения: одна буква даёт слишком много ложных замен. */
const MIN_NEEDLE = 2;

/** Собрать написания значений: само значение плюс `variants`, длинные — первыми. */
export function buildNeedles(entries: TokenSource[]): Needle[] {
  const map = new Map<string, Needle>();
  for (const entry of entries) {
    const name = String(entry.name ?? "").trim();
    if (!name) continue;
    const caseSensitive = entry.caseSensitive === true;
    const variants = [entry.value, ...(entry.variants ?? [])];
    for (const variant of variants) {
      const raw = String(variant ?? "").replace(/\s+/g, " ").trim();
      if (raw.length < MIN_NEEDLE) continue;
      // Значение со скобками токена сломает разбор — такое пропускаем.
      if (raw.includes(TOKEN_OPEN) || raw.includes(TOKEN_CLOSE)) continue;
      if (raw.includes("\n")) continue;
      const key = raw.toLowerCase();
      if (!map.has(key)) map.set(key, { raw, needle: key, name, caseSensitive });
    }
  }
  return [...map.values()].sort(
    (a, b) => b.raw.length - a.raw.length || a.raw.localeCompare(b.raw),
  );
}

function isWordAt(text: string, index: number): boolean {
  if (index < 0 || index >= text.length) return false;
  return WORD.test(text[index]);
}

/** Границы слова: перед началом совпадения и сразу после него. */
function isFreeStart(text: string, index: number): boolean {
  return !isWordAt(text, index - 1);
}

function isFreeEnd(text: string, index: number): boolean {
  return !isWordAt(text, index);
}

/**
 * Заменить значения на токены.
 *
 * `[[…]]` и `{{…}}` в тексте сначала приводятся к канону `⟦…⟧`.
 * Уже стоящие токены не меняются.
 */
export function valuesToTokens(text: string, entries: TokenSource[]): SubstitutionResult {
  const source = normalizeTokenForms(text ?? "");
  if (!source) return { text: "", hits: 0 };
  const needles = buildNeedles(entries);
  if (needles.length === 0) return { text: source, hits: 0 };

  // Диапазоны готовых токенов пропускаем целиком.
  const spans = parseTokens(source).map((token) => [token.start, token.end] as const);
  const lower = source.toLowerCase();
  const sameLength = lower.length === source.length;

  let out = "";
  let hits = 0;
  let i = 0;
  let spanIndex = 0;

  while (i < source.length) {
    const span = spans[spanIndex];
    if (span && i === span[0]) {
      out += source.slice(span[0], span[1]);
      i = span[1];
      spanIndex += 1;
      continue;
    }

    let replaced = false;
    if (isFreeStart(source, i)) {
      for (const needle of needles) {
        const end = i + needle.raw.length;
        if (end > source.length) continue;
        const slice = source.slice(i, end);
        if (needle.caseSensitive) {
          if (slice !== needle.raw) continue;
        } else {
          const chunk = sameLength ? lower.slice(i, end) : slice.toLowerCase();
          if (chunk !== needle.needle) continue;
        }
        if (!isFreeEnd(source, end)) continue;
        out += formatToken(needle.name);
        i = end;
        hits += 1;
        replaced = true;
        break;
      }
    }

    if (!replaced) {
      out += source[i];
      i += 1;
    }
  }

  return { text: out, hits };
}

/** Сколько раз значения справочника встречаются в тексте (без изменения текста). */
export function countValueHits(text: string, entries: TokenSource[]): number {
  return valuesToTokens(text, entries).hits;
}

export interface OfferSpan {
  start: number;
  end: number;
  name: string;
}

/**
 * Места, где значение справочника ещё написано открытым текстом.
 *
 * Те же иголки, что и при отправке: значение, варианты и падежи, если их
 * уже дописали в `variants`. Готовый ⟦токен⟧ не предлагаем заново.
 * Координаты — в исходной строке, без переписывания скобок.
 */
export function findOfferSpans(text: string, entries: readonly TokenSource[]): OfferSpan[] {
  const source = String(text ?? "");
  if (!source) return [];
  const needles = buildNeedles(entries as TokenSource[]);
  if (needles.length === 0) return [];
  const spans = parseTokens(source).map((token) => [token.start, token.end] as const);
  const lower = source.toLowerCase();
  const sameLength = lower.length === source.length;
  const found: OfferSpan[] = [];
  let i = 0;
  let spanIndex = 0;
  while (i < source.length) {
    const span = spans[spanIndex];
    if (span && i >= span[0] && i < span[1]) {
      i = span[1];
      spanIndex += 1;
      continue;
    }
    let replaced = false;
    if (isFreeStart(source, i)) {
      for (const needle of needles) {
        const end = i + needle.raw.length;
        if (end > source.length) continue;
        if (spans.some((item) => i < item[1] && end > item[0])) continue;
        const slice = source.slice(i, end);
        if (needle.caseSensitive) {
          if (slice !== needle.raw) continue;
        } else {
          const chunk = sameLength ? lower.slice(i, end) : slice.toLowerCase();
          if (chunk !== needle.needle) continue;
        }
        if (!isFreeEnd(source, end)) continue;
        found.push({ start: i, end, name: needle.name });
        i = end;
        replaced = true;
        break;
      }
    }
    if (!replaced) i += 1;
  }
  return found;
}
