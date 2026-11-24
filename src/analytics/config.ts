/**
 * Куда уходят визиты Gena.
 *
 * Тот же GoatCounter, что у code2graph (`stats.code2graph.ru`): без cookie,
 * страна и язык браузера считаются на сервере по запросу. Свой хост, чтобы
 * визиты Gena не смешивались с диаграммами.
 *
 *   VITE_GOATCOUNTER_URL=https://stats.example.com  → этот origin
 *   VITE_GOATCOUNTER_URL=                          → статистика выключена
 *   (не задано)                                    → DEFAULT_GOATCOUNTER_ORIGIN
 */

/** Хост по умолчанию, когда сборка не задаёт VITE_GOATCOUNTER_URL. */
export const DEFAULT_GOATCOUNTER_ORIGIN = "https://stats.code2graph.ru:8443";

/** Origin счётчика или пустая строка, если статистика выключена. */
export function resolveGoatCounterOrigin(
  raw: string | undefined = import.meta.env?.VITE_GOATCOUNTER_URL,
): string {
  if (raw === undefined) return DEFAULT_GOATCOUNTER_ORIGIN;
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  return trimmed.replace(/\/+$/, "");
}

/** Адрес `/count` или пустая строка, если статистика выключена. */
export function resolveGoatCounterCountUrl(raw?: string): string {
  const origin = resolveGoatCounterOrigin(raw);
  return origin === "" ? "" : `${origin}/count`;
}

export function isAnalyticsEnabled(raw?: string): boolean {
  return resolveGoatCounterOrigin(raw) !== "";
}
