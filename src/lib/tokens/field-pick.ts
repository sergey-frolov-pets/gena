/**
 * Тап по полю ввода: что стоит под пальцем — готовый токен или значение,
 * которое в токен превратится.
 *
 * На телефоне тап не создаёт выделения, поэтому плашка «выделение» молчит,
 * хотя человек явно ткнул в ⟦имя⟧ или в сумму. Здесь ищем фрагмент по каретке
 * в точке нажатия: сначала готовый токен, потом значение/вариант из справочника.
 * Модуль чистый — что показывать и куда писать решает экран.
 */

import { formatToken } from "./format";
import { findOccurrences, replaceSpan, tokenSpans } from "./occurrences";
import { normalizeFragment } from "./selection";

export interface PickEntry {
  name: string;
  value: string;
  variants?: string[];
}

export interface FieldPick {
  /** В черновике на этом месте стоит ⟦имя⟧ (иначе — просто значение). */
  tokenized: boolean;
  name: string;
  value: string;
  /** Диапазон в черновике: меняем ровно его, соседние вхождения не трогаем. */
  start: number;
  end: number;
  /** Что сейчас стоит в тексте — подпись в плашке. */
  text: string;
}

const TOKEN_NAME_RE = /^⟦([^⟦⟧\n]{1,80})⟧$/u;

/** Токен ⟦имя⟧, накрывающий каретку. */
export function tokenAtCaret(
  text: string,
  caret: number,
): { start: number; end: number; name: string } | null {
  const source = String(text ?? "");
  const at = Math.min(Math.max(Math.trunc(caret) || 0, 0), source.length);
  for (const span of tokenSpans(source)) {
    if (at < span.start || at > span.end) continue;
    const match = TOKEN_NAME_RE.exec(source.slice(span.start, span.end));
    if (!match) continue;
    const name = match[1].trim();
    if (!name) continue;
    return { start: span.start, end: span.end, name };
  }
  return null;
}

/**
 * Значение справочника, накрывающее каретку: самое длинное из совпадений.
 *
 * Длинное важнее короткого — иначе «Иван Петров» развалилось бы на «Иван».
 * Вхождения внутри слова и внутри токена не берём: это не отдельное значение.
 */
export function valueAtCaret<T extends PickEntry>(
  text: string,
  caret: number,
  entries: readonly T[],
): { start: number; end: number; entry: T } | null {
  const source = String(text ?? "");
  const at = Math.min(Math.max(Math.trunc(caret) || 0, 0), source.length);
  let best: { start: number; end: number; entry: T } | null = null;
  for (const entry of entries) {
    const forms = [entry.value, ...(entry.variants ?? [])];
    for (const form of forms) {
      for (const hit of findOccurrences(source, form)) {
        if (at < hit.start || at > hit.end) continue;
        if (!best || hit.end - hit.start > best.end - best.start) {
          best = { start: hit.start, end: hit.end, entry };
        }
      }
    }
  }
  return best;
}

/**
 * Что под кареткой: токен или значение.
 *
 * `null` — фрагмент не про справочник, плашку показывать нечего.
 */
export function describeFieldPick<T extends PickEntry>(
  text: string,
  caret: number,
  entries: readonly T[],
): FieldPick | null {
  const source = String(text ?? "");
  const token = tokenAtCaret(source, caret);
  if (token) {
    const key = normalizeFragment(token.name);
    const entry = entries.find((item) => normalizeFragment(item.name) === key);
    if (!entry) return null;
    return {
      tokenized: true,
      name: entry.name,
      value: entry.value,
      start: token.start,
      end: token.end,
      text: source.slice(token.start, token.end),
    };
  }
  const found = valueAtCaret(source, caret, entries);
  if (!found) return null;
  const text_ = source.slice(found.start, found.end);
  return {
    tokenized: false,
    name: found.entry.name,
    value: text_,
    start: found.start,
    end: found.end,
    text: text_,
  };
}

/**
 * Заменить найденный фрагмент на его вторую сторону.
 *
 * `token` — поставить ⟦имя⟧ вместо значения, `value` — вернуть значение
 * (отмена токенизации одного вхождения). Возвращает и позицию каретки,
 * чтобы поле не прыгало в конец.
 */
export function replaceFieldPick(
  text: string,
  pick: FieldPick,
  target: "token" | "value",
): { text: string; caret: number; changed: boolean } {
  const source = String(text ?? "");
  const replacement = target === "token" ? formatToken(pick.name) : pick.value;
  if (!replacement.trim()) return { text: source, caret: pick.end, changed: false };
  return {
    text: replaceSpan(source, pick.start, pick.end, replacement),
    caret: pick.start + replacement.length,
    changed: true,
  };
}
