/**
 * Список диалогов для листа истории: поиск по названию и порядок.
 *
 * Чистые функции — их проверяет `session-list.test.ts`, компонент только рисует.
 * Правило порядка: закреплённые сверху, дальше свежие первыми (по `updatedAt`).
 */

import type { Session } from "@/storage/types";

/** Поиск по названию без учёта регистра и лишних пробелов; пусто — весь список. */
export function matchesQuery(session: Session, query: string): boolean {
  const text = query.trim().toLowerCase();
  if (!text) return true;
  return session.title.toLowerCase().includes(text);
}

/** Закреплённые сверху, дальше по времени обновления. Исходный массив не меняется. */
export function sortSessions(list: readonly Session[]): Session[] {
  return [...list].sort((a, b) => {
    const pinA = a.pinned ? 1 : 0;
    const pinB = b.pinned ? 1 : 0;
    if (pinA !== pinB) return pinB - pinA;
    return b.updatedAt - a.updatedAt;
  });
}

/** Поиск + порядок одной функцией: то, что видно в листе истории. */
export function visibleSessions(list: readonly Session[], query: string): Session[] {
  return sortSessions(list.filter((session) => matchesQuery(session, query)));
}
