/**
 * Поиск приватных сущностей в тексте перед отправкой агенту (M3).
 *
 * Работает локально: текст никуда не уходит, поэтому детектор можно вызывать
 * на каждое нажатие клавиши. Серверный `/suggest` из плана добавит модель
 * детекции позже; правила ниже — базовый слой, который работает и без сети.
 *
 * Находки — только координаты и тип. Значение хранится для показа в панели,
 * в журнал отправок и в бэкап оно не попадает.
 */

export type FindingType = "money" | "date" | "card" | "phone" | "email" | "account";

export interface Finding {
  start: number;
  end: number;
  type: FindingType;
  /** Найденный фрагмент: показывается в панели, наружу не уходит. */
  value: string;
  /** 0..1 — насколько правило уверено; панель сортирует по нему. */
  confidence: number;
}

/** При пересечении спанов побеждает более специфичный тип. */
const PRIORITY: Record<FindingType, number> = {
  card: 6,
  account: 5,
  phone: 4,
  date: 3,
  money: 2,
  email: 1,
};

const MONEY_RUB =
  /(?<![\d.,])(?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+)(?:[.,]\d{1,2})?\s*(?:₽|руб(?:\.|лей|ля|ль)?|р\.?)(?![\p{L}\d])/giu;

const MONEY_SCALED =
  /(?<![\d.,])\d+(?:[.,]\d+)?\s*(?:млн|млрд|тыс)\.?\s*(?:₽|руб(?:\.|лей|ля)?|р\.)(?![\p{L}\d])/giu;

const MONEY_FX =
  /(?:[$€£]\s?\d[\d \u00a0\u202f.,]*|\d[\d \u00a0\u202f.,]*\s?(?:USD|EUR|долл(?:аров|ара|\.)?|евро)(?![\p{L}\d]))/giu;

const DATE_NUM = /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g;

const DATE_WORD =
  /\b\d{1,2}\s+(?:январ[яе]|феврал[яе]|марта?|апрел[яе]|ма[яе]|июн[яе]|июл[яе]|августа?|сентябр[яе]|октябр[яе]|ноябр[яе]|декабр[яе])\s+\d{4}/giu;

const PHONE =
  /(?:\+7|\b8)[\s\-(\u00a0]*(?:\d{3})[\s\-)\u00a0]*(?:\d{3})[\s\-]?(?:\d{2})[\s\-]?(?:\d{2})(?!\d)/g;

const EMAIL = /[\p{L}\d._%+-]+@[\p{L}\d.-]+\.[\p{L}]{2,}/giu;

/** Расчётный счёт: ровно 20 цифр подряд. */
const ACCOUNT = /(?<!\d)\d{20}(?!\d)/g;

/** Карта: 13–19 цифр, пробелы и дефисы как разделители. */
const CARD_CANDIDATE = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/** Проверка Луна: отсекает случайные 16 цифр (номер заказа, хеш и т.п.). */
function luhnOk(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = Number(digits[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

interface Collector {
  text: string;
  out: Finding[];
}

function collect(c: Collector, re: RegExp, type: FindingType, confidence: number, accept?: (v: string) => boolean): void {
  re.lastIndex = 0;
  let match = re.exec(c.text);
  while (match) {
    const value = match[0];
    if (!accept || accept(value)) {
      c.out.push({ start: match.index, end: match.index + value.length, type, value, confidence });
    }
    if (match.index === re.lastIndex) re.lastIndex += 1;
    match = re.exec(c.text);
  }
}

/**
 * Все находки без пересечений, по возрастанию позиции.
 * Текст длиннее 20 000 знаков не разбираем: это не сообщение, а вставка файла.
 */
export function detectFindings(text: string): Finding[] {
  if (!text || text.length > 20_000) return [];

  const c: Collector = { text, out: [] };
  collect(c, MONEY_RUB, "money", 0.9);
  collect(c, MONEY_SCALED, "money", 0.85);
  collect(c, MONEY_FX, "money", 0.7);
  collect(c, DATE_NUM, "date", 0.8);
  collect(c, DATE_WORD, "date", 0.85);
  collect(c, PHONE, "phone", 0.8);
  collect(c, EMAIL, "email", 0.9);
  collect(c, ACCOUNT, "account", 0.75);
  collect(c, CARD_CANDIDATE, "card", 0.6, (value) => luhnOk(digitsOnly(value)));

  const sorted = c.out.sort((a, b) => a.start - b.start || PRIORITY[b.type] - PRIORITY[a.type]);
  const result: Finding[] = [];
  let lastEnd = -1;
  for (const finding of sorted) {
    if (finding.start >= lastEnd) {
      result.push(finding);
      lastEnd = finding.end;
    }
  }
  return result;
}

/** Сводка по типам для панели: «2 суммы, 1 карта». */
export function summarize(findings: readonly Finding[]): Array<{ type: FindingType; count: number }> {
  const counts = new Map<FindingType, number>();
  for (const finding of findings) {
    counts.set(finding.type, (counts.get(finding.type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => PRIORITY[b.type] - PRIORITY[a.type] || b.count - a.count);
}
