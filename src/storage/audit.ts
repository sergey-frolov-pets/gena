/**
 * Журнал отправок: кто, куда, в каком режиме — без содержимого.
 *
 * Нужен, чтобы на вопрос «уходил ли открытый текст наружу» был ответ фактом,
 * а не воспоминанием. Пишем только метаданные: агент, сессия, режим, хост,
 * число подстановок и длина ушедшего текста. Ни текста, ни значений справочника.
 */

import { newId } from "@/lib/id";
import { getDb } from "@/storage/db";
import type { AuditEntry, PrivacyMode } from "@/storage/types";

/** Сколько записей держим: журнал нужен недавний, а не вечный. */
const AUDIT_LIMIT = 500;

export interface AuditInput {
  agentId: string;
  sessionId?: string;
  mode: PrivacyMode;
  /** Хост провайдера, не полный URL: путь иногда содержит идентификаторы. */
  provider: string;
  trusted: boolean;
  /** Сколько подстановок было в сообщении. */
  tokens?: number;
  /** Длина ушедшего текста. */
  chars?: number;
}

export async function recordAudit(input: AuditInput): Promise<AuditEntry> {
  const entry: AuditEntry = {
    id: newId("audit"),
    agentId: input.agentId,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    mode: input.mode,
    provider: input.provider,
    trusted: input.trusted,
    tokens: Math.max(0, Math.trunc(input.tokens ?? 0)),
    chars: Math.max(0, Math.trunc(input.chars ?? 0)),
    createdAt: Date.now(),
  };
  const db = await getDb();
  await db.put("audit", entry);
  await trimAudit(db);
  return entry;
}

/** Свежие записи первыми. */
export async function listAudit(limit = 100): Promise<AuditEntry[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex("audit", "by-created-at");
  return all.reverse().slice(0, Math.max(0, limit));
}

export async function clearAudit(): Promise<void> {
  const db = await getDb();
  await db.clear("audit");
}

/** Подрезать журнал до лимита: удаляем самые старые. */
async function trimAudit(db: Awaited<ReturnType<typeof getDb>>): Promise<void> {
  const keys = await db.getAllKeysFromIndex("audit", "by-created-at");
  const extra = keys.length - AUDIT_LIMIT;
  if (extra <= 0) return;
  const tx = db.transaction("audit", "readwrite");
  for (const key of keys.slice(0, extra)) {
    void tx.store.delete(key);
  }
  await tx.done;
}

export { AUDIT_LIMIT };
