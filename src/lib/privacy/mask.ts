/**
 * Маскирование находок (M3): значение заменяется типом в квадратных скобках.
 *
 * Квадратные скобки, а не `⟦…⟧`: последние заняты справочником токенов, и
 * `⟦сумма⟧` выглядел бы как токен, которого нет в справочнике. `[сумма]`
 * агент читает как «здесь было число», а подсветка композера не пытается
 * искать его в справочнике.
 */

import type { Finding, FindingType } from "./detect";

export const MASK_LABEL: Record<FindingType, string> = {
  money: "сумма",
  date: "дата",
  card: "карта",
  phone: "телефон",
  email: "почта",
  account: "счёт",
};

export function maskFor(type: FindingType): string {
  return `[${MASK_LABEL[type]}]`;
}

export interface MaskResult {
  text: string;
  /** Сколько фрагментов скрыто. */
  hidden: number;
}

/**
 * Заменяет находки масками. `types` ограничивает, какие типы скрывать:
 * снятая в панели галочка означает «этот тип оставить как есть».
 */
export function maskText(
  text: string,
  findings: readonly Finding[],
  types?: ReadonlySet<FindingType>,
): MaskResult {
  const chosen = types ? findings.filter((f) => types.has(f.type)) : findings;
  if (!chosen.length) return { text, hidden: 0 };

  let out = "";
  let cursor = 0;
  for (const finding of [...chosen].sort((a, b) => a.start - b.start)) {
    if (finding.start < cursor) continue;
    out += text.slice(cursor, finding.start);
    out += maskFor(finding.type);
    cursor = finding.end;
  }
  out += text.slice(cursor);
  return { text: out, hidden: chosen.length };
}
