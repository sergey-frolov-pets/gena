/**
 * Вхождения токенов (стор `occurrences`).
 *
 * Запись отвечает на вопрос «что стояло на этом месте» после перезагрузки:
 * в тексте и в отправке остаётся только токен, точный текст лежит здесь
 * запечатанным. Наружу его отдаёт `openOccurrenceForm`.
 */

import { getDb } from "./db";
import type { PrivacyOccurrence } from "./types";
import { openTokenValue, sealTokenValue } from "@/crypto/token-cipher";

/** Все вхождения диалога. */
export async function listOccurrences(sessionId: string): Promise<PrivacyOccurrence[]> {
  const db = await getDb();
  return db.getAllFromIndex("occurrences", "by-session", sessionId);
}

/** Вхождения конкретного сообщения (null — черновик). */
export async function listMessageOccurrences(
  messageId: string | null,
): Promise<PrivacyOccurrence[]> {
  const db = await getDb();
  if (messageId === null) return [];
  return db.getAllFromIndex("occurrences", "by-message", messageId);
}

/** Вхождения одной сущности: «где ещё стоит имя-1». */
export async function listEntityOccurrences(entityId: string): Promise<PrivacyOccurrence[]> {
  const db = await getDb();
  return db.getAllFromIndex("occurrences", "by-entity", entityId);
}

export async function getOccurrence(id: string): Promise<PrivacyOccurrence | undefined> {
  const db = await getDb();
  return db.get("occurrences", id);
}

/** Сколько замен реально стоит в диалоге — от этого зависит выключение щита. */
export async function countApplied(sessionId: string): Promise<number> {
  const all = await listOccurrences(sessionId);
  return all.filter((item) => item.status === "applied").length;
}

export async function putOccurrence(occurrence: PrivacyOccurrence): Promise<void> {
  const db = await getDb();
  await db.put("occurrences", occurrence);
}

export async function deleteOccurrence(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("occurrences", id);
}

/** Убрать вхождения диалога (восстановление значений, очистка). */
export async function clearSessionOccurrences(sessionId: string): Promise<void> {
  const db = await getDb();
  const keys = await db.getAllKeysFromIndex("occurrences", "by-session", sessionId);
  if (keys.length === 0) return;
  const tx = db.transaction("occurrences", "readwrite");
  await Promise.all([...keys.map((key) => tx.store.delete(key)), tx.done]);
}

export async function clearOccurrences(): Promise<void> {
  const db = await getDb();
  await db.clear("occurrences");
}

/** Запечатать точный текст вхождения. */
export function sealOccurrenceForm(form: string, occurrenceId: string): Promise<string> {
  return sealTokenValue(form, occurrenceId);
}

/** Распечатать точный текст вхождения; битая запись — пустая строка. */
export async function openOccurrenceForm(occurrence: PrivacyOccurrence): Promise<string> {
  try {
    return await openTokenValue(occurrence.sealedForm, occurrence.id);
  } catch {
    return "";
  }
}
