/**
 * Время в чате: часы у сообщения и длительность ответа.
 *
 * Длительность ответа — от реплики пользователя до готового ответа
 * (у новых сообщений она уже записана в `elapsedMs`, у старых считается
 * по времени соседних сообщений).
 */

/** Короткие подписи единиц; в UI приходят из i18n. */
export interface DurationUnits {
  h: string;
  m: string;
  s: string;
}

const DEFAULT_UNITS: DurationUnits = { h: "ч", m: "мин", s: "с" };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Часы:минуты по местному времени — «09:05». Пустая строка на мусор. */
export function formatClock(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "";
  const date = new Date(ts);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Длительность ответа: «<1 с», «42 с», «1 мин 05 с», «1 ч 04 мин».
 * Крупные единицы съедают мелкие: часы показываем без секунд.
 */
export function formatDuration(ms: number, units: DurationUnits = DEFAULT_UNITS): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `<1 ${units.s}`;
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total} ${units.s}`;
  if (ms < HOUR) {
    const minutes = Math.floor(total / 60);
    const seconds = total - minutes * 60;
    return `${minutes} ${units.m} ${String(seconds).padStart(2, "0")} ${units.s}`;
  }
  const hours = Math.floor(ms / HOUR);
  const minutes = Math.floor((ms - hours * HOUR) / MINUTE);
  return `${hours} ${units.h} ${String(minutes).padStart(2, "0")} ${units.m}`;
}

/** Минимум, чтобы понять, сколько шёл ответ. */
interface TimedMessage {
  role: string;
  createdAt: number;
  elapsedMs?: number;
}

/**
 * Сколько шёл ответ `list[index]`: записанное значение, иначе разница
 * с ближайшей предыдущей репликой пользователя. `null` — считать не из чего.
 */
export function answerElapsed(
  list: readonly TimedMessage[],
  index: number,
): number | null {
  const message = list[index];
  if (!message || message.role !== "assistant") return null;
  if (typeof message.elapsedMs === "number" && message.elapsedMs >= 0) {
    return message.elapsedMs;
  }
  for (let i = index - 1; i >= 0; i -= 1) {
    if (list[i].role === "user") {
      return Math.max(0, message.createdAt - list[i].createdAt);
    }
  }
  return null;
}
