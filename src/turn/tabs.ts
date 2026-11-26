/**
 * Полоска недавних диалогов: какие вкладки открыты, какие закрыты человеком.
 *
 * Логика без Vue и без IndexedDB: списки id приходят и уходят параметрами,
 * поэтому порядок вкладок проверяется тестом, а не глазами в браузере.
 */

/** Сколько вкладок держим в полоске; лишние вытесняются самыми старыми. */
export const MAX_TABS = 6;

export interface IdListStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface TabLists {
  /** Порядок открытых вкладок: как их открывали, без перестановок. */
  tabIds: string[];
  /** Диалоги, вкладку которых человек закрыл крестиком. */
  hiddenIds: string[];
}

export interface TabSource {
  id: string;
  updatedAt: number;
}

/** Список id из хранилища: битые записи и не-строки просто отбрасываются. */
export function readIdList(storage: Pick<IdListStore, "getItem">, key: string): string[] {
  try {
    const raw = storage.getItem(key);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function writeIdList(storage: IdListStore, key: string, ids: string[]): void {
  try {
    storage.setItem(key, JSON.stringify(ids));
  } catch {
    // Приватный режим или отключённое хранилище — полоска живёт до перезагрузки.
  }
}

/**
 * Открыть диалог в полоске. Порядок вкладок стабилен: выбранный диалог остаётся
 * на своём месте, а не прыгает в начало. Новый диалог встаёт в конец, лишние
 * вытесняются слева (самые давние). Закрытая ранее вкладка снова становится видимой.
 */
export function openTab(lists: TabLists, id: string, max = MAX_TABS): TabLists {
  const hiddenIds = lists.hiddenIds.filter((item) => item !== id);
  if (lists.tabIds.includes(id)) {
    return { tabIds: lists.tabIds, hiddenIds };
  }
  return { tabIds: [...lists.tabIds, id].slice(-max), hiddenIds };
}

/** Закрыть вкладку: диалог остаётся в списке и вернётся, когда его откроют снова. */
export function closeTab(lists: TabLists, id: string): TabLists {
  return {
    tabIds: lists.tabIds.filter((item) => item !== id),
    hiddenIds: lists.hiddenIds.includes(id) ? lists.hiddenIds : [...lists.hiddenIds, id],
  };
}

/**
 * Какую вкладку открыть после закрытия `closedId`.
 * Порядок — как в полоске слева направо. Правый сосед, если его нет — левый.
 * `null` значит, что полоска опустела и нужен новый диалог.
 * Неизвестная вкладка не двигает выбор: остаётся первая из оставшихся.
 */
export function tabAfterClose(ids: readonly string[], closedId: string): string | null {
  const index = ids.indexOf(closedId);
  if (index < 0) return ids[0] ?? null;
  return ids[index + 1] ?? ids[index - 1] ?? null;
}

/**
 * Что видно в полоске: сначала открытые вкладки в сохранённом порядке,
 * затем активный диалог, дальше свежие по времени. Закрытая вкладка сама не возвращается.
 */
export function visibleTabs<T extends TabSource>(
  sessions: readonly T[],
  activeId: string | null,
  tabIds: readonly string[],
  hiddenIds: readonly string[],
  max = MAX_TABS,
): T[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const hidden = new Set(hiddenIds);
  const out: T[] = [];
  const seen = new Set<string>();

  const push = (session: T | undefined): void => {
    if (!session || seen.has(session.id) || hidden.has(session.id)) return;
    seen.add(session.id);
    out.push(session);
  };

  for (const id of tabIds) push(byId.get(id));
  if (activeId) push(byId.get(activeId));
  const fresh = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  for (const session of fresh) {
    if (out.length >= max) break;
    push(session);
  }
  return out.slice(0, max);
}
