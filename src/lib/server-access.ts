/**
 * Срок доступа к серверу Gena: сколько дней осталось и как это показать.
 *
 * Дата приходит из двух мест:
 *   1. сервер сам сообщает её в `/api/health` (флаг `-access-until`);
 *   2. человек вписал её в карточке сервера вручную.
 * Ручная дата главнее: она позволяет поставить срок, даже если сервер старый.
 */

export type AccessTone = "none" | "ok" | "soon" | "expired";

export interface AccessState {
  /** Настроение плашки: нет срока, всё хорошо, скоро кончится, уже истёк. */
  tone: AccessTone;
  /** Дата в виде ДД.ММ.ГГГГ (пусто, если даты нет). */
  date: string;
  /** Сколько дней осталось (0 — последний день, отрицательное — просрочка). */
  days: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const SOON_DAYS = 7;

/** Разобрать ISO-дату или `2026-12-31`; дата без времени значит «до конца дня». */
export function parseAccessDate(value?: string | null): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const dayOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (dayOnly) {
    const [, year, month, day] = dayOnly;
    // Дата без времени — «доступен до конца этого дня» по местным часам.
    return new Date(Number(year), Number(month) - 1, Number(day), 23, 59, 59);
  }
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? null : at;
}

export function formatAccessDate(at: Date): string {
  const day = String(at.getDate()).padStart(2, "0");
  const month = String(at.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${at.getFullYear()}`;
}

/** Состояние доступа на момент `now`. Пустая или кривая дата — «срок не указан». */
export function serverAccessState(until?: string | null, now = Date.now()): AccessState {
  const at = parseAccessDate(until);
  if (!at) return { tone: "none", date: "", days: 0 };
  const left = at.getTime() - now;
  const days = Math.ceil(left / DAY_MS);
  const tone: AccessTone = left <= 0 ? "expired" : days <= SOON_DAYS ? "soon" : "ok";
  return { tone, date: formatAccessDate(at), days: Math.max(days, 0) };
}

/** Дата из поля ввода `<input type="date">` → ISO-строка для хранения. */
export function accessDateToStore(input: string): string {
  const at = parseAccessDate(input);
  return at ? at.toISOString() : "";
}
