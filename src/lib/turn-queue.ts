/**
 * Чистые правила очереди по диалогам.
 *
 * Компонент чата только рисует и запускает отправку; какие реплики можно
 * взять прямо сейчас — считается здесь, без Vue и без IndexedDB.
 */

/** Минимум, который нужен от реплики очереди для планирования. */
export interface QueueEntry {
  id: string;
  sessionId?: string;
}

/** Диалог занят: идёт ход или отправка уже началась. */
export function isBusySession(
  turns: Record<string, unknown>,
  dispatching: Iterable<string>,
  sessionId: string | null | undefined,
): boolean {
  if (!sessionId) return false;
  if (turns[sessionId] !== undefined) return true;
  for (const id of dispatching) if (id === sessionId) return true;
  return false;
}

/** Сколько диалогов работает прямо сейчас (без двойного счёта). */
export function liveSessionCount(
  turns: Record<string, unknown>,
  dispatching: Iterable<string>,
): number {
  const ids = new Set<string>(Object.keys(turns));
  for (const id of dispatching) ids.add(id);
  return ids.size;
}

export interface PickOptions {
  /** Диалог занят — его реплики не берём. */
  isBusy: (sessionId: string | undefined) => boolean;
  /** Сколько ходов уже идёт. */
  live: number;
  /** Потолок одновременных ходов. */
  limit: number;
  /** Диалог, который сейчас не трогаем (например, только что упавший). */
  skipSessionId?: string;
}

/**
 * Первая реплика очереди, которую можно отправить прямо сейчас.
 * `undefined` — все либо ждут свой диалог, либо упёрлись в потолок.
 */
export function pickRunnable<T extends QueueEntry>(
  queue: readonly T[],
  options: PickOptions,
): T | undefined {
  if (options.live >= options.limit) return undefined;
  return queue.find(
    (item) =>
      item.sessionId !== options.skipSessionId && !options.isBusy(item.sessionId),
  );
}
