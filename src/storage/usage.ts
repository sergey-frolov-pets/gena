/**
 * Дневной лимит вызовов агента.
 *
 * Счётчик хранится в IndexedDB (стор `usage`, ключ — agentId) с отметкой дня
 * в UTC. При смене дня счётчик сбрасывается лениво — при первом обращении.
 *
 * `callLimit <= 0` означает «без лимита»: canCall всегда true, recordCall
 * всё равно ведёт статистику (пригодится в UI).
 */

import { deleteUsage, getUsage, putUsage } from "./db";
import type { UsageRecord } from "./types";

/** Текущий день в формате YYYY-MM-DD (UTC). */
export function utcDay(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Прочитать счётчик на указанный день, сбрасывая устаревший. */
async function readUsage(agentId: string, day: string): Promise<UsageRecord> {
  const existing = await getUsage(agentId);
  if (!existing || existing.day !== day) {
    return { agentId, day, count: 0 };
  }
  return existing;
}

/** Сколько вызовов уже сделано сегодня. */
export async function getCallCount(agentId: string, now: number = Date.now()): Promise<number> {
  const record = await readUsage(agentId, utcDay(now));
  return record.count;
}

/** Осталось вызовов сегодня; при `limit <= 0` возвращает Infinity. */
export async function remainingCalls(
  agentId: string,
  limit: number,
  now: number = Date.now(),
): Promise<number> {
  if (limit <= 0) {
    return Infinity;
  }
  const used = await getCallCount(agentId, now);
  return Math.max(0, limit - used);
}

/** Можно ли сделать ещё один вызов. */
export async function canCall(
  agentId: string,
  limit: number,
  now: number = Date.now(),
): Promise<boolean> {
  if (limit <= 0) {
    return true;
  }
  const used = await getCallCount(agentId, now);
  return used < limit;
}

/** Записать один успешный вызов. Возвращает новый счётчик. */
export async function recordCall(agentId: string, now: number = Date.now()): Promise<number> {
  const day = utcDay(now);
  const record = await readUsage(agentId, day);
  const next: UsageRecord = { agentId, day, count: record.count + 1 };
  await putUsage(next);
  return next.count;
}

/** Сбросить счётчик агента (например, при удалении агента или вручную). */
export async function resetUsage(agentId: string): Promise<void> {
  await deleteUsage(agentId);
}
