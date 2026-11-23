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
 * Запомнить форму: вызывается до замены, когда в тексте ещё стоит значение.
 *
 * `at` — позиция вхождения в черновике; номер считается по уже стоящим
 * токенам, то есть новый ⟦имя⟧ займёт ровно этот номер.
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
  store.set(storeKey(name, tokenIndexAt(text, name, at)), value);
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
