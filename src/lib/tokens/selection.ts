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

/** Имя из выделенного токена `⟦имя⟧`; пустая строка — это не токен. */
export function fragmentTokenName(selection: string): string {
  const text = String(selection ?? "").trim();
  const match = /^⟦([^⟦⟧\n]{1,80})⟧$/u.exec(text) ?? /^\[\[([^[\]\r\n]{1,80})\]\]$/u.exec(text);
  return match ? normalizeFragment(match[1]) : "";
}

/**
 * Запись справочника для выделения.
 *
 * Совпадением считается не только значение: человек может выделить уже
 * вставленный токен `⟦имя⟧` или само имя записи — тогда замена тоже должна
 * предлагаться, иначе выделение выглядит «немым». Значение и варианты
 * проверяются первыми: у двух записей может совпасть имя и чужое значение.
 */
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
  const tokenName = fragmentTokenName(selection);
  if (tokenName) {
    const byToken = entries.find((entry) => normalizeFragment(entry.name) === tokenName);
    if (byToken) return byToken;
  }
  return entries.find((entry) => normalizeFragment(entry.name) === key) ?? null;
}

/* ── Предложение имени токена ─────────────────────────────────────────── */

/** Служебные слова: из них имя токена не делаем. */
const STOP_WORDS = new Set([
  "в", "во", "на", "для", "из", "с", "со", "и", "по", "к", "ко", "у", "о", "об",
  "от", "до", "за", "под", "над", "при", "без", "про", "через", "что", "это",
  "ооо", "оао", "зао", "пао", "ао", "ип",
  "the", "a", "an", "of", "for", "to", "in", "on", "at", "and", "or", "with",
]);

/**
 * Справочник базовых имён: из него берётся основа, когда из выделенного текста
 * осмысленного слова не выходит (только цифры, знаки) или когда по виду
 * значения понятно, что это сумма, телефон, компания и т. п.
 * Имя всегда нумеруется: `сумма1`, `телефон2`, `компания1`, `имя1`.
 */
export const NAME_BASES = {
  fallback: "имя",
  amount: "сумма",
  phone: "телефон",
  company: "компания",
  account: "счёт",
  date: "дата",
  email: "почта",
} as const;

export type NameBase = (typeof NAME_BASES)[keyof typeof NAME_BASES];

/** Имя токена: только буквы и цифры, нижний регистр, не длиннее 24 символов. */
const NAME_MAX_LEN = 24;
/** Сколько номеров перебираем, прежде чем добавить время. */
const NAME_NUMBER_MAX = 99;

function cleanName(raw: string): string {
  const word = String(raw ?? "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLocaleLowerCase();
  if (!word) return "";
  // Только цифры («1200») именем не годятся: непонятно, что это за значение.
  if (!/\p{L}/u.test(word)) return "";
  return word.slice(0, NAME_MAX_LEN);
}

/**
 * Имя с номером: `имя1`, `сумма1`. Нумерация всегда начинается с единицы,
 * поэтому «имя1 уже занято» даёт «имя2», а не «имя3».
 */
function numberedName(base: string, used: Set<string>): string {
  for (let i = 1; i <= NAME_NUMBER_MAX; i += 1) {
    const candidate = `${base}${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}${Date.now() % 1000}`;
}

const PHONE_RE = /^\+?[\d\s()\-.]{10,}$/u;
const MONEY_RE = /(₽|руб|\$|€|¥)/iu;
const EMAIL_RE = /@[^\s@]+\.[^\s@]+/u;
const DATE_RE = /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/u;
const LEGAL_RE = /(^|\s)(ооо|оао|зао|пао|ао|ип)(\s|$)/iu;

/** Сколько цифр в тексте — по ним отличаем телефон и сумму от слова. */
function digitCount(text: string): number {
  return (text.match(/\d/gu) ?? []).length;
}

/**
 * Категория значения по его виду: сумма, телефон, компания, дата, почта.
 * Пустая строка — вид не распознан, имя берём из слов текста.
 */
export function categoryBase(text: string, words: readonly string[] = []): string {
  const clean = String(text ?? "").trim();
  if (!clean) return "";
  if (EMAIL_RE.test(clean)) return NAME_BASES.email;
  if (DATE_RE.test(clean)) return NAME_BASES.date;
  if (digitCount(clean) >= 10 && PHONE_RE.test(clean)) return NAME_BASES.phone;
  if (MONEY_RE.test(clean)) return NAME_BASES.amount;
  if (LEGAL_RE.test(clean)) return NAME_BASES.company;
  if (words.length === 0 && digitCount(clean) > 0) return NAME_BASES.amount;
  return "";
}

/**
 * Предложить имена для нового токена из выделенного текста.
 *
 * Порядок: первое значимое слово («цена 1 200 ₽» → «цена1»), второе слово,
 * затем категория по виду значения («1 200 ₽» → «сумма1», «+7 916 …» →
 * «телефон1», «ООО Ромашка» → «компания1»), в конце — «имя1».
 * Каждое имя нумеруется, поэтому занятое «цена1» даёт «цена2».
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
  const category = categoryBase(text, meaningful);
  if (category && !bases.includes(category)) bases.push(category);
  if (!bases.includes(NAME_BASES.fallback)) bases.push(NAME_BASES.fallback);

  const result: string[] = [];
  for (const base of bases) {
    if (result.length >= limit) break;
    const name = numberedName(base, used);
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
