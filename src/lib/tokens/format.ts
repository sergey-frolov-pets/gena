/**
 * Формат токенов справочника.
 *
 * Канонический вид: `⟦имя⟧` (U+27E6 / U+27E7). Эти скобки почти не встречаются
 * в обычном тексте, не ломают markdown и LaTeX, а санитайзер пропускает их как текст.
 *
 * На вводе терпим привычные `[[имя]]` и `{{имя}}` — они приводятся к канону.
 */

export const TOKEN_OPEN = "\u27E6";
export const TOKEN_CLOSE = "\u27E7";

/** Верхняя граница длины имени: длиннее — уже не имя, а абзац. */
export const TOKEN_MAX_NAME = 80;

/** Символы, которые нельзя ставить внутрь имени: сломают разбор токенов. */
const FORBIDDEN = /[\u27E6\u27E7[\]{}<>\r\n\t]/;

const BRACKET_FORMS: Array<[RegExp, string]> = [
  [/\[\[([^[\]\r\n]{1,80})\]\]/g, `${TOKEN_OPEN}$1${TOKEN_CLOSE}`],
  [/\{\{([^{}\r\n]{1,80})\}\}/g, `${TOKEN_OPEN}$1${TOKEN_CLOSE}`],
];

export interface ParsedToken {
  /** Имя внутри токена, без скобок. */
  name: string;
  /** Смещение первого символа токена в тексте. */
  start: number;
  /** Смещение сразу после закрывающей скобки. */
  end: number;
  /** Исходный фрагмент целиком, вместе со скобками. */
  raw: string;
}

/** Имя токена: убрать лишние пробелы, скобки по краям и переводы строк. */
export function normalizeTokenName(raw: string): string {
  return String(raw ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^[\u27E6\u27E7[\]{}]+/, "")
    .replace(/[\u27E6\u27E7[\]{}]+$/, "")
    .trim()
    .slice(0, TOKEN_MAX_NAME);
}

/** Ключ уникальности имени — без учёта регистра. */
export function tokenNameKey(name: string): string {
  return normalizeTokenName(name).toLowerCase();
}

/** Годится ли имя для токена. */
export function isValidTokenName(name: string): boolean {
  const value = normalizeTokenName(name);
  return value.length > 0 && value.length <= TOKEN_MAX_NAME && !FORBIDDEN.test(value);
}

/** Канонический токен по имени. */
export function formatToken(name: string): string {
  return `${TOKEN_OPEN}${normalizeTokenName(name)}${TOKEN_CLOSE}`;
}

/**
 * Привести `[[…]]` и `{{…}}` к канону. Уже канонические токены не трогаются.
 */
export function normalizeTokenForms(text: string): string {
  let result = String(text ?? "");
  for (const [pattern, replacement] of BRACKET_FORMS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/** Все канонические токены текста, по порядку. */
export function parseTokens(text: string): ParsedToken[] {
  const source = String(text ?? "");
  const result: ParsedToken[] = [];
  let from = 0;
  while (from < source.length) {
    const open = source.indexOf(TOKEN_OPEN, from);
    if (open < 0) break;
    const close = source.indexOf(TOKEN_CLOSE, open + 1);
    if (close < 0) break;
    const name = normalizeTokenName(source.slice(open + 1, close));
    if (name) {
      result.push({
        name,
        start: open,
        end: close + 1,
        raw: source.slice(open, close + 1),
      });
    }
    from = close + 1;
  }
  return result;
}

/** Сколько канонических токенов в тексте. */
export function countTokens(text: string): number {
  return parseTokens(text).length;
}

/** Значение по имени токена либо `undefined`, если имя не найдено. */
export type TokenLookup = (name: string) => string | undefined;

/**
 * Заменить токены на значения. Неизвестные имена остаются как есть —
 * человек должен видеть, что токен не опознан, а текст не должен теряться.
 */
export function tokensToValues(text: string, lookup: TokenLookup): string {
  const source = String(text ?? "");
  const tokens = parseTokens(source);
  if (tokens.length === 0) return source;
  let out = "";
  let from = 0;
  for (const token of tokens) {
    out += source.slice(from, token.start);
    const value = lookup(token.name);
    out += value && value.trim() ? value : token.raw;
    from = token.end;
  }
  return out + source.slice(from);
}
