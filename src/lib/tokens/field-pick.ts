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
import { replaceSpan, tokenSpans } from "./occurrences";
import { normalizeFragment } from "./selection";
import { findOfferSpans } from "./substitute";

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

/**
 * Все написания записи: канон, явные варианты и падежи из словаря.
 *
 * Повтор в другом регистре не дублируем — в списке остаётся первое.
 */
export function listForms(
  value: string,
  variants: readonly string[] = [],
  declensions: readonly string[] = [],
): string[] {
  const seen = new Set<string>();
  const forms: string[] = [];
  for (const raw of [value, ...variants, ...declensions]) {
    const form = String(raw ?? "").replace(/\s+/g, " ").trim();
    const key = form.toLocaleLowerCase();
    if (!form || seen.has(key)) continue;
    seen.add(key);
    forms.push(form);
  }
  return forms;
}

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
  const hit = findOfferSpans(source, entries).find((span) => at >= span.start && at <= span.end);
  if (!hit) return null;
  const key = normalizeFragment(hit.name);
  const entry = entries.find((item) => normalizeFragment(item.name) === key);
  if (!entry) return null;
  return { start: hit.start, end: hit.end, entry };
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
 * (отмена токенизации одного вхождения). `form` — исходная форма значения
 * («вклада ВТБ»), с которой токен вставили: возвращаем её, а не канон
 * справочника. Возвращает и позицию каретки, чтобы поле не прыгало в конец.
 */
export function replaceFieldPick(
  text: string,
  pick: FieldPick,
  target: "token" | "value",
  form?: string | null,
): { text: string; caret: number; changed: boolean } {
  const source = String(text ?? "");
  const original = String(form ?? "").trim() ? String(form) : pick.value;
  const replacement = target === "token" ? formatToken(pick.name) : original;

  if (!replacement.trim()) return { text: source, caret: pick.end, changed: false };
  return {
    text: replaceSpan(source, pick.start, pick.end, replacement),
    caret: pick.start + replacement.length,
    changed: true,
  };
}
