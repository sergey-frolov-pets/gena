/**
 * Подсказка токенов по мере набора: как только в поле появляется `⟦`,
 * показываем имена из справочника, отфильтрованные по набранному.
 *
 * Терпимые формы `[[…]]` и `{{…}}` тоже открывают подсказку: при отправке
 * они всё равно приводятся к канону `⟦…⟧` (см. `format.ts`).
 */

export interface TokenTrigger {
  /** Индекс открывающей скобки в тексте. */
  start: number;
  /** Что набрано после неё до каретки. */
  query: string;
}

const OPENERS: { open: string; close: string }[] = [
  { open: "⟦", close: "⟧" },
  { open: "[[", close: "]]" },
  { open: "{{", close: "}}" },
];

/** Длиннее — уже не имя, а обычный текст: подсказку не показываем. */
const MAX_QUERY = 60;

/** Символы, после которых пробел перед ними не нужен. */
const NO_SPACE_BEFORE = /[\s.,;:!?)\]}>»…]/;

function clampCaret(text: string, caret: number): number {
  const pos = Number.isFinite(caret) ? Math.trunc(caret) : text.length;
  return Math.min(Math.max(pos, 0), text.length);
}

/**
 * Открытый фрагмент токена перед кареткой.
 *
 * Берём самое позднее открытие: если в тексте уже есть `⟦a⟧` и человек начал
 * второй токен, подсказка относится ко второму. Закрытый токен, перевод строки
 * или слишком длинный хвост — не подсказка.
 */
export function findTokenTrigger(text: string, caret: number): TokenTrigger | null {
  const pos = clampCaret(text, caret);
  const before = text.slice(0, pos);

  let best: { start: number; open: string; close: string } | null = null;
  for (const pair of OPENERS) {
    const at = before.lastIndexOf(pair.open);
    if (at < 0) continue;
    if (!best || at > best.start) best = { start: at, open: pair.open, close: pair.close };
  }
  if (!best) return null;

  const tail = before.slice(best.start + best.open.length);
  if (tail.includes(best.close)) return null;
  if (tail.includes("\n") || tail.length > MAX_QUERY) return null;

  return { start: best.start, query: tail };
}

export interface TokenPickResult {
  /** Новый текст поля. */
  text: string;
  /** Куда поставить курсор после вставки. */
  caret: number;
}

/**
 * Заменить открытый фрагмент (`⟦вк`) на готовый токен `⟦имя⟧`.
 *
 * Каретка встаёт сразу после закрывающей скобки. Пробел добавляется только
 * когда без него токен слипся бы со следующим словом.
 */
export function applyTokenPick(
  text: string,
  caret: number,
  name: string,
  trigger: TokenTrigger,
): TokenPickResult {
  const pos = clampCaret(text, caret);
  const clean = name.trim();
  if (!clean || trigger.start > pos) return { text, caret: pos };

  const before = text.slice(0, trigger.start);
  const after = text.slice(pos);
  const literal = `⟦${clean}⟧`;
  const tail = after.length > 0 && !NO_SPACE_BEFORE.test(after[0]) ? " " : "";

  return {
    text: `${before}${literal}${tail}${after}`,
    caret: before.length + literal.length,
  };
}

/**
 * Имена для подсказки: совпадение по подстроке, начинающиеся с запроса — выше.
 * Пустой запрос отдаёт весь список в прежнем порядке.
 */
export function filterTokenNames(names: string[], query: string, limit = 8): string[] {
  const q = query.trim().toLowerCase();
  const matched = names
    .map((name) => ({ name, lower: name.toLowerCase() }))
    .filter(({ lower }) => (q ? lower.includes(q) : true));

  matched.sort((a, b) => {
    if (q) {
      const aStarts = a.lower.startsWith(q) ? 0 : 1;
      const bStarts = b.lower.startsWith(q) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
    }
    return a.lower.localeCompare(b.lower, "ru");
  });

  return matched.slice(0, Math.max(1, limit)).map(({ name }) => name);
}
