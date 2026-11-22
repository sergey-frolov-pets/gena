/**
 * Хранилище справочника подстановок (стор `tokens`).
 *
 * Записи лежат с запечатанным значением: расшифровка — в `lib/tokens/registry.ts`.
 */

import { getDb } from "./db";
import type { TokenRecord } from "./types";

/** Все записи, свежие сверху. */
export async function listTokenRecords(): Promise<TokenRecord[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex("tokens", "by-updated");
  return all.reverse();
}

export async function getTokenRecord(id: string): Promise<TokenRecord | undefined> {
  const db = await getDb();
  return db.get("tokens", id);
}

export async function getTokenRecordByNameKey(nameKey: string): Promise<TokenRecord | undefined> {
  const db = await getDb();
  return db.getFromIndex("tokens", "by-name-key", nameKey);
}

export async function putTokenRecord(record: TokenRecord): Promise<void> {
  const db = await getDb();
  await db.put("tokens", record);
}

export async function deleteTokenRecord(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("tokens", id);
}

export async function clearTokenRecords(): Promise<void> {
  const db = await getDb();
  await db.clear("tokens");
}
