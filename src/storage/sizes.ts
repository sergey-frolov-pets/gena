/**
 * Подсчёт «веса» данных в IndexedDB: агенты, сессии, сообщения.
 *
 * Считается по запросу (кнопка «Пересчитать»): проход по всем сообщениям на
 * большом архиве занимает секунды, поэтому при открытии вкладки ничего не меряем.
 * Размер записи = JSON в UTF-8, без сжатия — так, как она лежит в базе.
 */

import { listAgents, listAllMessages, listSessions } from "./db";
import { recordBytes } from "@/lib/sizes";
import type { Agent, Message, Session } from "./types";

export interface SessionSize {
  sessionId: string;
  agentId: string;
  /** Сколько сообщений в сессии. */
  messageCount: number;
  /** Байты записи сессии. */
  sessionBytes: number;
  /** Байты всех сообщений сессии. */
  messageBytes: number;
  /** Всё вместе: запись сессии + её сообщения. */
  totalBytes: number;
}

export interface StorageSizes {
  /** Размер по каждой сессии — для строк списка. */
  sessions: Record<string, SessionSize>;
  agentCount: number;
  sessionCount: number;
  messageCount: number;
  agentBytes: number;
  sessionBytes: number;
  messageBytes: number;
  /** Агенты + сессии + сообщения. */
  totalBytes: number;
}

function seed(): StorageSizes {
  return {
    sessions: {},
    agentCount: 0,
    sessionCount: 0,
    messageCount: 0,
    agentBytes: 0,
    sessionBytes: 0,
    messageBytes: 0,
    totalBytes: 0,
  };
}

/** Свести записи в размеры. Вынесено отдельно от IndexedDB — так тестируется. */
export function aggregateSizes(
  agents: Agent[],
  sessions: Session[],
  messages: Message[],
): StorageSizes {
  const result = seed();

  result.agentCount = agents.length;
  for (const agent of agents) {
    result.agentBytes += recordBytes(agent);
  }

  result.sessionCount = sessions.length;
  for (const session of sessions) {
    const bytes = recordBytes(session);
    result.sessionBytes += bytes;
    result.sessions[session.id] = {
      sessionId: session.id,
      agentId: session.agentId,
      messageCount: 0,
      sessionBytes: bytes,
      messageBytes: 0,
      totalBytes: bytes,
    };
  }

  result.messageCount = messages.length;
  for (const message of messages) {
    const bytes = recordBytes(message);
    result.messageBytes += bytes;
    const entry = result.sessions[message.sessionId];
    if (entry) {
      entry.messageCount += 1;
      entry.messageBytes += bytes;
      entry.totalBytes += bytes;
    }
  }

  result.totalBytes = result.agentBytes + result.sessionBytes + result.messageBytes;
  return result;
}

/** Прочитать базу и посчитать размеры. */
export async function measureStorage(): Promise<StorageSizes> {
  const [agents, sessions, messages] = await Promise.all([
    listAgents(),
    listSessions(),
    listAllMessages(),
  ]);
  return aggregateSizes(agents, sessions, messages);
}
