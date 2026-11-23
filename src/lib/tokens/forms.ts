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

import { normalizeTokenName, parseTokens } from "./format";
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

/**
 * Сменить форму уже стоящего токена, не сдвигая соседние номера.
 *
 * `rememberForm` рассчитан на вставку нового ⟦имя⟧. Если токен уже в тексте,
 * тот же сдвиг утащил бы форму следующего вхождения на номер вперёд.
 */
export function setForm(
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

/** Форма по имени и номеру вхождения — без разбора текста (номер уже известен). */
export function formAt(store: FormStore, name: string, index: number): string | null {
  const value = store.get(storeKey(name, index));
  return value && value.trim() ? value : null;
}

/**
 * Резолвер форм для показа поля: `visibleText` и подсветка зовут его на
 * каждый токен, поэтому форма отдаётся по имени и номеру, без поиска по тексту.
 */
export function formLookup(
  store: FormStore,
): (name: string, index: number) => string | null {
  return (name, index) => formAt(store, name, index);
}

/**
 * Запомнить формы, добытые перекодировкой поля (значения → токены).
 *
 * `hits` идут в порядке появления токенов в новом тексте, поэтому номер
 * вхождения каждого имени считается по самому тексту. Форма, которую поле
 * только что показало, должна остаться той же при следующем переключении —
 * иначе набор в режиме значений «переодевал» бы текст в канон справочника.
 */
export function applyForms(
  store: FormStore,
  text: string,
  hits: readonly { name: string; form: string }[],
): void {
  if (hits.length === 0) return;
  const queues = new Map<string, string[]>();
  for (const hit of hits) {
    const form = String(hit.form ?? "");
    if (!form.trim()) continue;
    const key = nameKey(hit.name);
    const queue = queues.get(key);
    if (queue) queue.push(form);
    else queues.set(key, [form]);
  }
  if (queues.size === 0) return;
  const used = new Map<string, number>();
  for (const token of parseTokens(String(text ?? ""))) {
    const key = nameKey(token.name);
    const queue = queues.get(key);
    if (!queue) continue;
    const index = used.get(key) ?? 0;
    if (index >= queue.length) continue;
    used.set(key, index + 1);
    store.set(storeKey(token.name, index), queue[index]);
  }
}

/**
 * Формы токенов текста по порядку вхождений.
 *
 * Пустая строка — форму этого вхождения ещё не запоминали. Длина массива
 * равна числу токенов, чтобы «дырка» посередине не сдвигала соседние формы.
 */
export function formsOf(store: FormStore, text: string): string[] {
  const used = new Map<string, number>();
  const forms: string[] = [];
  for (const token of parseTokens(String(text ?? ""))) {
    const key = nameKey(token.name);
    const index = used.get(key) ?? 0;
    used.set(key, index + 1);
    forms.push(formAt(store, token.name, index) ?? "");
  }
  return forms;
}

/**
 * Записать формы вхождений заново.
 *
 * Прежние номера этих имён стираются: текст перенесли из другого места,
 * и формы прошлого черновика не должны прилипнуть к новым вхождениям.
 * `forms` — по одному значению на токен, в порядке текста.
 */
export function assignForms(store: FormStore, text: string, forms: readonly string[]): void {
  const tokens = parseTokens(String(text ?? ""));
  const names = new Set(tokens.map((token) => nameKey(token.name)));
  for (const key of [...store.keys()]) {
    const hash = key.lastIndexOf("#");
    if (hash < 0) continue;
    if (names.has(key.slice(0, hash))) store.delete(key);
  }
  const used = new Map<string, number>();
  tokens.forEach((token, position) => {
    const key = nameKey(token.name);
    const index = used.get(key) ?? 0;
    used.set(key, index + 1);
    const form = String(forms[position] ?? "");
    if (!form.trim()) return;
    store.set(storeKey(token.name, index), form);
  });
}

/**
 * Запомненная форма важнее угаданной по предлогу.
 *
 * Длины должны совпасть с числом токенов: иначе это формы другого текста,
 * и подставлять их нельзя.
 */
export function preferForms(
  saved: readonly string[] | null | undefined,
  fallback: readonly string[],
): string[] {
  if (!saved || saved.length !== fallback.length) return [...fallback];
  return fallback.map((form, index) => {
    const kept = String(saved[index] ?? "").trim();
    return kept || form;
  });
}

/** Исходные формы отправленной реплики: id сообщения → формы по порядку токенов. */
const keptById = new Map<string, string[]>();

/** Запомнить формы реплики, пока экран открыт. На диск значения не пишем. */
export function keepForms(id: string, forms: readonly string[]): void {
  const key = String(id ?? "");
  if (!key) return;
  if (!forms.some((form) => String(form ?? "").trim())) {
    keptById.delete(key);
    return;
  }
  keptById.set(key, forms.map((form) => String(form ?? "")));
}

/** Формы, запомненные при отправке этой реплики. */
export function keptForms(id: string): string[] | null {
  const forms = keptById.get(String(id ?? ""));
  return forms ? [...forms] : null;
}
