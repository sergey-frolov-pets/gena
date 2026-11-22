/**
 * Хранилище скачанного морфологического словаря (стор `morph`).
 *
 * Одна запись на язык: сейчас всегда `ru`. Словарь публичный (не секрет),
 * поэтому лежит как есть — без шифрования.
 */

import { getDb } from "./db";
import type { MorphRecord } from "./types";

export const MORPH_ID = "ru";

export async function readMorphRecord(): Promise<MorphRecord | null> {
  const db = await getDb();
  const record = await db.get("morph", MORPH_ID);
  return record ?? null;
}

export async function writeMorphRecord(record: MorphRecord): Promise<void> {
  const db = await getDb();
  await db.put("morph", record);
}

export async function clearMorphRecord(): Promise<void> {
  const db = await getDb();
  await db.delete("morph", MORPH_ID);
}
