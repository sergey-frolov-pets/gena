/**
 * Страховочная копия агентов и списка диалогов в localStorage.
 *
 * Зачем: сборка обновляется, база — нет, но обновление не должно оставлять
 * человека без подключений и истории. Копия маленькая (без сообщений),
 * пишется с задержкой после каждого изменения и читается, только если база
 * поднялась пустой.
 *
 * Ключи агентов лежат здесь в том же запечатанном виде, что и в базе
 * (`sealedKey` — шифртекст под ключ устройства), открытых значений нет.
 */

import type { Agent, Session } from "./types";

const SNAPSHOT_KEY = "gena.snapshot.v1";
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export interface Snapshot {
  v: 1;
  at: number;
  agents: Agent[];
  sessions: Session[];
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Приватный режим: копии не будет, но приложение работает.
    return null;
  }
}

/** Прочитать копию. Мусор в хранилище не должен ломать запуск. */
export function readSnapshot(now = Date.now()): Snapshot | null {
  const store = storage();
  if (!store) return null;
  let raw: string | null = null;
  try {
    raw = store.getItem(SNAPSHOT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Snapshot>;
    if (parsed.v !== 1) return null;
    if (typeof parsed.at !== "number" || now - parsed.at > MAX_AGE_MS) return null;
    if (!Array.isArray(parsed.agents) || !Array.isArray(parsed.sessions)) return null;
    return { v: 1, at: parsed.at, agents: parsed.agents, sessions: parsed.sessions };
  } catch {
    return null;
  }
}

/** Записать копию. Переполнение хранилища не должно ронять интерфейс. */
export function writeSnapshot(agents: Agent[], sessions: Session[], at = Date.now()): boolean {
  const store = storage();
  if (!store) return false;
  if (agents.length === 0 && sessions.length === 0) {
    // Пустое состояние — не повод затирать последнюю живую копию.
    return false;
  }
  const snapshot: Snapshot = { v: 1, at, agents, sessions };
  try {
    store.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

export function clearSnapshot(): void {
  try {
    storage()?.removeItem(SNAPSHOT_KEY);
  } catch {
    // ignore
  }
}

/** Есть ли что восстанавливать: копия не пустая. */
export function hasRestorableSnapshot(now = Date.now()): boolean {
  const snapshot = readSnapshot(now);
  return !!snapshot && snapshot.agents.length + snapshot.sessions.length > 0;
}
