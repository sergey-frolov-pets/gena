/**
 * Исходная форма значения при токенизации.
 *
 * Человек написал «вклада ВТБ» — вставили ⟦вклад⟧. Если снять токенизацию,
 * вернуть нужно ровно «вклада ВТБ», а не каноническое «вклад ВТБ» из
 * справочника: падеж и регистр — часть текста, а не часть записи.
 *
 * Храним в памяти экрана: имя + номер вхождения → форма. Номер считаем по
 * черновику, иначе два ⟦вклад⟧ в разных местах получили бы одну форму.
 * На диск не пишем: значение на диск не попадает (черновик хранит токены).
 */

import { normalizeTokenName } from "./format";
import { tokenSpans } from "./occurrences";

/** Имя+номер вхождения → исходная форма. */
export type FormStore = Map<string, string>;

const TOKEN_NAME_RE = /^⟦([^⟦⟧\n]{1,80})⟧$/u;

function nameKey(name: string): string {
  return normalizeTokenName(name).toLocaleLowerCase();
}

function storeKey(name: string, index: number): string {
  return `${nameKey(name)}#${index}`;
}

/** Номер вхождения токена ⟦имя⟧: сколько таких же стоит раньше `at`. */
export function tokenIndexAt(text: string, name: string, at: number): number {
  const source = String(text ?? "");
  const key = nameKey(name);
  const pos = Math.max(0, Math.trunc(at) || 0);
  let index = 0;
  for (const span of tokenSpans(source)) {
    const match = TOKEN_NAME_RE.exec(source.slice(span.start, span.end));
    if (!match) continue;
    if (nameKey(match[1]) !== key) continue;
    if (span.start >= pos) break;
    index += 1;
  }
  return index;
}

/**
 * Новый ⟦имя⟧ встал на номер `fromIndex` — прежние номера сдвинулись.
 *
 * Номер вхождения — это порядок токенов в тексте. Вставили токен в середину,
 * и все одноимённые после него стали на единицу дальше: если не переложить
 * формы, второй ⟦вклад⟧ начнёт показывать форму первого.
 */
export function shiftForms(store: FormStore, name: string, fromIndex: number): void {
  const prefix = `${nameKey(name)}#`;
  const start = Number.isFinite(fromIndex) ? Math.max(0, Math.trunc(fromIndex)) : 0;
  const moved: Array<{ from: string; to: string; value: string }> = [];
  for (const key of [...store.keys()]) {
    if (!key.startsWith(prefix)) continue;
    const index = Number.parseInt(key.slice(prefix.length), 10);
    if (!Number.isFinite(index) || index < start) continue;
    const value = store.get(key);
    if (value === undefined) continue;
    moved.push({ from: key, to: `${prefix}${index + 1}`, value });
  }
  if (moved.length === 0) return;
  // Сначала убираем все прежние ключи, потом ставим новые: иначе сдвиг
  // «1→2, 2→3» затёр бы соседа.
  for (const item of moved) store.delete(item.from);
  for (const item of moved) store.set(item.to, item.value);
}

/**
 * Запомнить форму: вызывается до замены, когда в тексте ещё стоит значение.
 *
 * `at` — позиция вхождения в черновике; номер считается по уже стоящим
 * токенам, то есть новый ⟦имя⟧ займёт ровно этот номер. Одноимённые токены
 * справа переезжают на номер вперёд — их формы тоже.
 */
export function rememberForm(
  store: FormStore,
  text: string,
  name: string,
  at: number,
  form: string,
): void {
  const value = String(form ?? "");
  if (!value.trim()) return;
  const index = tokenIndexAt(text, name, at);
  shiftForms(store, name, index);
  store.set(storeKey(name, index), value);
}

/** Форма, с которой этот токен был вставлен (если знаем). */
export function lookupForm(
  store: FormStore,
  text: string,
  name: string,
  at: number,
): string | null {
  const value = store.get(storeKey(name, tokenIndexAt(text, name, at)));
  return value && value.trim() ? value : null;
}

/** Запись справочника изменилась — её формы больше не актуальны. */
export function forgetForms(store: FormStore, name: string): void {
  const prefix = `${nameKey(name)}#`;
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
