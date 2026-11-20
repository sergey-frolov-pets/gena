/**
 * Размеры данных: форматирование байтов и подсчёт «веса» записей IndexedDB.
 *
 * Единицы — КБ/МБ/ГБ по 1024, дробная часть — один знак с разделителем локали
 * (`12,4 КБ` для ru, `12.4 КБ` для en). Байты — целым числом.
 */

const UNITS = ["Б", "КБ", "МБ", "ГБ"] as const;

/** Человеческий размер: `840 Б`, `12,4 КБ`, `1,2 МБ`, `0,3 ГБ`. */
export function formatSize(bytes: number, locale = "ru"): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return `0 ${UNITS[0]}`;

  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  if (unit === 0) return `${Math.round(value)} ${UNITS[unit]}`;

  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
  return `${formatted} ${UNITS[unit]}`;
}

/** Размер значения в байтах UTF-8 так, как он лежит в IndexedDB (JSON). */
export function recordBytes(value: unknown): number {
  const json = JSON.stringify(value);
  if (json === undefined) return 0;
  return new TextEncoder().encode(json).length;
}
