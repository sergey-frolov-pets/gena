/**
 * Вставка токена в текст поля ввода.
 *
 * Нужна панели «Вставить токен»: имя выбирается из справочника, а канон
 * `⟦имя⟧` дописывается туда, где стоит курсор. Пробелы вокруг добавляются
 * только когда без них токен слипся бы с соседним словом.
 */

/** Канонический вид токена. Пустое или пробельное имя недопустимо. */
export function tokenLiteral(name: string): string {
  return `⟦${name.trim()}⟧`;
}

export interface InsertResult {
  /** Новый текст поля. */
  text: string;
  /** Куда поставить курсор после вставки. */
  caret: number;
}

function isBoundary(char: string | undefined): boolean {
  return char === undefined || /\s/.test(char);
}

/**
 * Вставить токен в позицию `caret`.
 *
 * Позиция за пределами текста прижимается к границам: кривой `selectionStart`
 * не должен терять набранное. Уже стоящий рядом токен не дублируется.
 */
export function insertTokenAt(text: string, caret: number, name: string): InsertResult {
  const literal = tokenLiteral(name);
  const size = text.length;
  const pos = Math.min(Math.max(Number.isFinite(caret) ? Math.trunc(caret) : size, 0), size);
  const before = text.slice(0, pos);
  const after = text.slice(pos);

  if (!literal.trim() || literal === "⟦⟧") return { text, caret: pos };
  if (before.endsWith(literal) || after.startsWith(literal)) return { text, caret: pos };

  const lead = before.length > 0 && !isBoundary(before.at(-1)) ? " " : "";
  const tail = after.length > 0 && !isBoundary(after.at(0)) ? " " : "";
  const inserted = `${lead}${literal}${tail}`;

  return { text: `${before}${inserted}${after}`, caret: pos + lead.length + literal.length };
}
