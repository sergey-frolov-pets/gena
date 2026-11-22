/**
 * Слой IndexedDB поверх `idb`.
 *
 * База `gena`, версия 4. Сторы:
 *   agents   (keyPath id)                       — подключения к агентам
 *   sessions (keyPath id, index by-agent, by-updated) — диалоги
 *   messages (keyPath id, index by-session)     — сообщения
 *   usage    (keyPath agentId)                  — счётчик вызовов агента за сутки
 *   queue    (keyPath id)                       — реплики, ждущие ответа агента
 *   tokens   (keyPath id, index by-name-key, by-updated) — справочник подстановок
 *   morph    (keyPath id)                       — скачанный морфологический словарь
 *
 * Все функции тонкие; бизнес-логика (шифрование, бэкап, очистка) — выше.
 * Миграции идемпотентны: существующие данные не трогаются, добавляются
 * только новые сторы (v2 — `usage`, v3 — `queue`, v4 — `tokens`, v5 — `morph`).
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  normalizeAgent,
  type Agent,
  type Message,
  type MorphRecord,
  type Session,
  type TokenRecord,
  type UsageRecord,
} from "./types";
import type { QueuedRecord } from "./queue";

const DB_NAME = "gena";
const DB_VERSION = 5;

interface GenaDB extends DBSchema {
  agents: {
    key: string;
    value: Agent;
  };
  sessions: {
    key: string;
    value: Session;
    indexes: {
      "by-agent": string;
      "by-updated": number;
    };
  };
  messages: {
    key: string;
    value: Message;
    indexes: {
      "by-session": string;
      "by-session-created": [string, number];
    };
  };
  usage: {
    key: string;
    value: UsageRecord;
  };
  queue: {
    key: string;
    value: QueuedRecord;
  };
  tokens: {
    key: string;
    value: TokenRecord;
    indexes: {
      "by-name-key": string;
      "by-updated": number;
    };
  };
  morph: {
    key: string;
    value: MorphRecord;
  };
}

let dbPromise: Promise<IDBPDatabase<GenaDB>> | null = null;

/**
 * Базу не отдали: другая вкладка держит старую версию и не даёт обновиться.
 * Молча ждать в таком случае нельзя — интерфейс показывал бы пустые списки,
 * как будто данные пропали.
 */
export class StorageBlockedError extends Error {
  readonly code = "storage_blocked";

  constructor() {
    super("storage is blocked by another tab");
    this.name = "StorageBlockedError";
  }
}

/** Сколько ждём открытия, прежде чем сказать «не получилось» и дать повтор. */
const OPEN_TIMEOUT_MS = 4_000;

export function getDb(): Promise<IDBPDatabase<GenaDB>> {
  if (!dbPromise) {
    dbPromise = openDatabase();
    // Неудачу не запоминаем: следующая попытка (или кнопка «Повторить»)
    // должна открыть базу заново, а не получить тот же отказ.
    void dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

function openDatabase(): Promise<IDBPDatabase<GenaDB>> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => fail(new StorageBlockedError()), OPEN_TIMEOUT_MS);

    openDB<GenaDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("agents")) {
          db.createObjectStore("agents", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("sessions")) {
          const store = db.createObjectStore("sessions", { keyPath: "id" });
          store.createIndex("by-agent", "agentId");
          store.createIndex("by-updated", "updatedAt");
        }
        if (!db.objectStoreNames.contains("messages")) {
          const store = db.createObjectStore("messages", { keyPath: "id" });
          store.createIndex("by-session", "sessionId");
          store.createIndex("by-session-created", ["sessionId", "createdAt"]);
        }
        if (!db.objectStoreNames.contains("usage")) {
          db.createObjectStore("usage", { keyPath: "agentId" });
        }
        if (!db.objectStoreNames.contains("queue")) {
          db.createObjectStore("queue", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("tokens")) {
          const store = db.createObjectStore("tokens", { keyPath: "id" });
          store.createIndex("by-name-key", "nameKey", { unique: true });
          store.createIndex("by-updated", "updatedAt");
        }
        if (!db.objectStoreNames.contains("morph")) {
          db.createObjectStore("morph", { keyPath: "id" });
        }
      },
      /** Наша вкладка мешает обновлению в другой — отпускаем базу сами. */
      blocking() {
        void closeDb();
      },
      /** Другая вкладка держит старую версию — не висим, а честно сообщаем. */
      blocked() {
        fail(new StorageBlockedError());
      },
      terminated() {
        dbPromise = null;
      },
    })
      .then((db) => {
        // Обновление в другой вкладке: закрываемся, чтобы ей не мешать.
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        if (settled) {
          db.close();
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(db);
      })
      .catch(fail);
  });
}

/** Закрыть соединение и сбросить кэш — для тестов и «полной очистки». */
export async function closeDb(): Promise<void> {
  if (dbPromise) {
    try {
      const db = await dbPromise;
      db.close();
    } catch {
      // ignore
    }
  }
  dbPromise = null;
}

/** Сбросить кэш без закрытия (устаревший путь; используйте closeDb). */
export function resetDbCache(): void {
  dbPromise = null;
}

// ---------- Agents ----------

export async function putAgent(agent: Agent): Promise<void> {
  const db = await getDb();
  await db.put("agents", agent);
}

export async function getAgent(id: string): Promise<Agent | undefined> {
  const db = await getDb();
  const agent = await db.get("agents", id);
  return agent ? normalizeAgent(agent) : undefined;
}

export async function listAgents(): Promise<Agent[]> {
  const db = await getDb();
  const all = await db.getAll("agents");
  return all.map(normalizeAgent);
}

export async function deleteAgent(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("agents", id);
}

// ---------- Sessions ----------

export async function putSession(session: Session): Promise<void> {
  const db = await getDb();
  await db.put("sessions", session);
}

export async function getSession(id: string): Promise<Session | undefined> {
  const db = await getDb();
  return db.get("sessions", id);
}

/** Все сессии, свежие сверху. */
export async function listSessions(): Promise<Session[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex("sessions", "by-updated");
  return all.reverse();
}

export async function listSessionsByAgent(agentId: string): Promise<Session[]> {
  const db = await getDb();
  return db.getAllFromIndex("sessions", "by-agent", agentId);
}

export async function deleteSession(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["sessions", "messages"], "readwrite");
  await tx.objectStore("sessions").delete(id);
  const msgStore = tx.objectStore("messages");
  const keys = await msgStore.index("by-session").getAllKeys(id);
  for (const key of keys) {
    await msgStore.delete(key);
  }
  await tx.done;
}

// ---------- Messages ----------

export async function putMessage(message: Message): Promise<void> {
  const db = await getDb();
  await db.put("messages", message);
}

export async function listMessages(sessionId: string): Promise<Message[]> {
  const db = await getDb();
  return db.getAllFromIndex("messages", "by-session-created", IDBKeyRange.bound(
    [sessionId, -Infinity],
    [sessionId, Infinity],
  ));
}

/** Все сообщения базы — для подсчёта размеров и полного бэкапа. */
export async function listAllMessages(): Promise<Message[]> {
  const db = await getDb();
  return db.getAll("messages");
}

export async function deleteMessage(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("messages", id);
}

export async function deleteMessagesBySession(sessionId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("messages", "readwrite");
  const store = tx.objectStore("messages");
  const keys = await store.index("by-session").getAllKeys(sessionId);
  for (const key of keys) {
    await store.delete(key);
  }
  await tx.done;
}

// ---------- Usage (счётчик вызовов агента за сутки) ----------

export async function getUsage(agentId: string): Promise<UsageRecord | undefined> {
  const db = await getDb();
  return db.get("usage", agentId);
}

export async function putUsage(record: UsageRecord): Promise<void> {
  const db = await getDb();
  await db.put("usage", record);
}

export async function deleteUsage(agentId: string): Promise<void> {
  const db = await getDb();
  await db.delete("usage", agentId);
}
