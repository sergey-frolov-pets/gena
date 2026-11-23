/**
 * Стандартные основы имён токенов: «сумма1», «компания2», «ПО1».
 *
 * Список правится в справочнике и живёт на устройстве. Номер — следующий
 * свободный среди уже занятых имён, чтобы основа не столкнулась с записью.
 */

const STORAGE_KEY = "gena.token.nameBases";

export const DEFAULT_NAME_BASES = [
  "имя",
  "компания",
  "ПО",
  "модуль",
  "сумма",
  "телефон",
  "счёт",
  "дата",
  "почта",
];

const MAX_BASES = 24;
const MAX_LEN = 24;

/** Основа имени: буквы и цифры, как человек записал, без пустых дублей. */
export function sanitizeNameBases(input: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of input) {
    const base = String(item ?? "")
      .trim()
      .replace(/[^\p{L}\p{N}]+/gu, "");
    if (!base || base.length > MAX_LEN) continue;
    if (!/\p{L}/u.test(base)) continue;
    const key = base.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(base);
    if (result.length >= MAX_BASES) break;
  }
  return result;
}

export function loadNameBases(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...DEFAULT_NAME_BASES];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_NAME_BASES];
    const clean = sanitizeNameBases(parsed.map((item) => String(item)));
    return clean.length > 0 ? clean : [...DEFAULT_NAME_BASES];
  } catch {
    return [...DEFAULT_NAME_BASES];
  }
}

export function saveNameBases(input: readonly string[]): string[] {
  const clean = sanitizeNameBases(input);
  const stored = clean.length > 0 ? clean : [...DEFAULT_NAME_BASES];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  return stored;
}

/** Следующий номер основы: «компания» при занятых компания1 → «компания2». */
export function nextBaseName(base: string, taken: readonly string[]): string {
  const key = base.toLocaleLowerCase();
  let max = 0;
  for (const name of taken) {
    const match = /^(.*?)(\d+)$/u.exec(String(name ?? "").trim());
    if (!match || match[1].toLocaleLowerCase() !== key) continue;
    const n = Number(match[2]);
    if (n > max) max = n;
  }
  return `${base}${max + 1}`;
}

/**
 * Подсказки для выделения: основы с номером.
 *
 * `prefer` — основа, которую поставить первой, если она есть в списке
 * («1 200 ₽» → сумма). Пишется так, как задана в справочнике.
 */
export function suggestBaseNames(
  bases: readonly string[],
  taken: readonly string[],
  prefer = "",
  limit = 6,
): string[] {
  const list = sanitizeNameBases(bases);
  const pref = prefer.trim().toLocaleLowerCase();
  const ordered = pref
    ? [...list.filter((base) => base.toLocaleLowerCase() === pref), ...list.filter((base) => base.toLocaleLowerCase() !== pref)]
    : list;
  const used = new Set(taken.map((name) => String(name).toLocaleLowerCase()));
  const result: string[] = [];
  for (const base of ordered) {
    if (result.length >= limit) break;
    let name = nextBaseName(base, [...used]);
    while (used.has(name.toLocaleLowerCase())) {
      used.add(name.toLocaleLowerCase());
      name = nextBaseName(base, [...used]);
    }
    used.add(name.toLocaleLowerCase());
    result.push(name);
  }
  return result;
}
