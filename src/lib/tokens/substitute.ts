/**
 * Движок подстановки: значения справочника ↔ токены.
 *
 * Что умеет:
 *  - значения из нескольких слов («вклад ВТБ в Альфа-Банке»);
 *  - разные написания одного значения — падежи, сокращения, обратный порядок
 *    слов — задаются в `variants` записи, поэтому морфология здесь не гадает;
 *  - регистр не важен, границы слова соблюдаются (иначе «ВТБ» вырезался бы
 *    из середины другого слова);
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
}

export interface SubstitutionResult {
  text: string;
  /** Сколько вхождений заменили — для счётчика в интерфейсе. */
  hits: number;
}

interface Needle {
  /** Приведённое к нижнему регистру написание. */
  needle: string;
  name: string;
}

const WORD = /[\p{L}\p{N}_]/u;

/** Минимальная длина значения: одна буква даёт слишком много ложных замен. */
const MIN_NEEDLE = 2;

/** Собрать написания значений: само значение плюс `variants`, длинные — первыми. */
export function buildNeedles(entries: TokenSource[]): Needle[] {
  const map = new Map<string, string>();
  for (const entry of entries) {
    const name = String(entry.name ?? "").trim();
    if (!name) continue;
    const variants = [entry.value, ...(entry.variants ?? [])];
    for (const variant of variants) {
      const needle = String(variant ?? "").replace(/\s+/g, " ").trim();
      if (needle.length < MIN_NEEDLE) continue;
      // Значение со скобками токена сломает разбор — такое пропускаем.
      if (needle.includes(TOKEN_OPEN) || needle.includes(TOKEN_CLOSE)) continue;
      if (needle.includes("\n")) continue;
      const key = needle.toLowerCase();
      if (!map.has(key)) map.set(key, name);
    }
  }
  return [...map.entries()]
    .map(([needle, name]) => ({ needle, name }))
    .sort((a, b) => b.needle.length - a.needle.length || a.needle.localeCompare(b.needle));
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
        const end = i + needle.needle.length;
        if (end > source.length) continue;
        const chunk = sameLength ? lower.slice(i, end) : source.slice(i, end).toLowerCase();
        if (chunk !== needle.needle) continue;
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
