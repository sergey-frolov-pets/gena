/**
 * Очередь реплик в IndexedDB: переживает закрытие приложения.
 *
 * Реплика, написанная при занятом агенте, ждёт своей очереди. Раньше очередь
 * жила только в памяти — закрыл вкладку, и текст пропадал. Теперь она лежит
 * в сторе `queue` (база `gena`, версия 3).
 *
 * Полный data-URL картинки не сохраняется: правило проекта (`images.ts`) —
 * тяжёлые данные живут только в памяти. Поэтому после перезагрузки у реплики
 * остаются текст и документы, а картинки — нет; сколько их было, помним
 * в `imagesDropped`, чтобы честно предупредить пользователя.
 */

import { getDb } from "./db";
import type { PreparedDocument } from "@/lib/documents";

export interface QueuedRecord {
  id: string;
  /** Диалог, в который реплика была написана. */
  sessionId?: string;
  /** false — текст уже есть в истории (правка сообщения), дублировать не нужно. */
  persist: boolean;
  text: string;
  docs: PreparedDocument[];
  /** Сколько картинок было в реплике — они не сохраняются. */
  imagesDropped: number;
  /** Когда реплику поставили в очередь (мс), порядок отправки — по нему. */
  at: number;
}

/** Вся сохранённая очередь: реплики в порядке постановки. */
export async function listQueued(): Promise<QueuedRecord[]> {
  const db = await getDb();
  const all = await db.getAll("queue");
  return all.sort((a, b) => a.at - b.at);
}

/** Заменить сохранённую очередь целиком — очередь короткая, переписывать дёшево. */
export async function replaceQueued(items: readonly QueuedRecord[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("queue", "readwrite");
  const store = tx.objectStore("queue");
  await store.clear();
  for (const item of items) {
    await store.put(item);
  }
  await tx.done;
}

/** Убрать всё из сохранённой очереди. */
export async function clearQueued(): Promise<void> {
  const db = await getDb();
  await db.clear("queue");
}
