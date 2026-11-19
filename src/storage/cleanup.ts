/**
 * Очистка IndexedDB с сохранением выбранных сессий.
 *
 * Две операции:
 *   clearAll()                  — удалить все сессии и сообщения (+ агентов по флагу).
 *   clearExcept(keepSessionIds) — удалить всё, КРОМЕ перечисленных сессий.
 *
 * Агенты по умолчанию сохраняются: удаление истории не должно рвать подключения.
 */

import {
  closeDb,
  deleteAgent,
  deleteSession,
  listAgents,
  listMessages,
  listSessions,
} from "./db";

export interface ClearResult {
  removedSessions: number;
  removedMessages: number;
  removedAgents: number;
}

/** Удалить все сессии и сообщения. Агентов — только если removeAgents=true. */
export async function clearAll(removeAgents = false): Promise<ClearResult> {
  const sessions = await listSessions();
  let removedMessages = 0;

  for (const session of sessions) {
    const messages = await listMessages(session.id);
    removedMessages += messages.length;
    await deleteSession(session.id);
  }

  let removedAgents = 0;
  if (removeAgents) {
    const agents = await listAgents();
    for (const agent of agents) {
      await deleteAgent(agent.id);
      removedAgents += 1;
    }
  }

  return {
    removedSessions: sessions.length,
    removedMessages,
    removedAgents,
  };
}

/**
 * Удалить все сессии, КРОМЕ перечисленных (и их сообщения).
 * Агенты не трогаются. Возвращает, что удалено.
 */
export async function clearExcept(keepSessionIds: readonly string[]): Promise<ClearResult> {
  const keep = new Set(keepSessionIds);
  const sessions = await listSessions();
  let removedSessions = 0;
  let removedMessages = 0;

  for (const session of sessions) {
    if (keep.has(session.id)) {
      continue;
    }
    const messages = await listMessages(session.id);
    removedMessages += messages.length;
    await deleteSession(session.id);
    removedSessions += 1;
  }

  return { removedSessions, removedMessages, removedAgents: 0 };
}

/** Полностью стереть базу (на случай «сброс всего»). */
export async function dropDatabase(): Promise<void> {
  await closeDb();
  try {
    await globalThis.indexedDB?.deleteDatabase("gena");
  } catch {
    // ignore
  }
}
