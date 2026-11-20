/**
 * Чистые преобразования очереди реплик между памятью и хранилищем.
 *
 * В памяти у реплики есть полные data-URL картинок; в IndexedDB они не едут
 * (см. `storage/queue.ts`). Здесь — только арифметика: что сохранить, что
 * восстановить, что выбросить как неотправляемое.
 */

import type { PreparedDocument } from "./documents";

/** Минимум, который нужен от реплики в памяти, чтобы её сохранить. */
export interface QueueSource {
  id: string;
  sessionId?: string;
  persist: boolean;
  text: string;
  images: readonly unknown[];
  docs: readonly PreparedDocument[];
  /** Когда реплику поставили в очередь; нет — возьмём `now`. */
  at?: number;
}

/** Запись очереди после восстановления — то, что можно снова отправить. */
export interface RestoredQueue {
  id: string;
  sessionId?: string;
  persist: boolean;
  text: string;
  docs: PreparedDocument[];
  /** Сколько картинок потерялось при сохранении. */
  imagesDropped: number;
  /** Когда реплику поставили в очередь (мс) — порядок отправки. */
  at: number;
}

/** Сохраняемая запись: та же реплика, но без картинок. */
export interface PersistedQueue {
  id: string;
  sessionId?: string;
  persist: boolean;
  text: string;
  docs: PreparedDocument[];
  imagesDropped: number;
  at: number;
}

/** Реплика из памяти → запись для IndexedDB. */
export function toPersisted(item: QueueSource, now: number): PersistedQueue {
  const at = Number.isFinite(item.at) ? (item.at as number) : Number.isFinite(now) ? now : Date.now();
  return {
    id: item.id,
    sessionId: item.sessionId,
    persist: item.persist,
    text: item.text,
    docs: item.docs.map((doc) => ({ ...doc })),
    imagesDropped: item.images.length,
    at,
  };
}

function isDocument(value: unknown): value is PreparedDocument {
  if (!value || typeof value !== "object") return false;
  const doc = value as Partial<PreparedDocument>;
  return (
    typeof doc.name === "string" &&
    typeof doc.text === "string" &&
    typeof doc.bytes === "number" &&
    typeof doc.kind === "string" &&
    typeof doc.truncated === "boolean"
  );
}

/** Похоже ли значение на сохранённую запись очереди (данные могли испортиться). */
export function isPersistedQueue(value: unknown): value is PersistedQueue {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PersistedQueue>;
  return (
    typeof item.id === "string" &&
    item.id.length > 0 &&
    typeof item.persist === "boolean" &&
    typeof item.text === "string" &&
    typeof item.at === "number" &&
    Number.isFinite(item.at) &&
    Array.isArray(item.docs)
  );
}

/**
 * Запись из IndexedDB → реплика для отправки.
 * `null` — отправлять нечего: текст пуст, документов нет, а картинки не сохранены.
 */
export function restoreQueued(item: PersistedQueue): RestoredQueue | null {
  const docs = item.docs.filter(isDocument);
  if (!item.text.trim() && docs.length === 0) return null;
  return {
    id: item.id,
    sessionId: typeof item.sessionId === "string" ? item.sessionId : undefined,
    persist: item.persist,
    text: item.text,
    docs,
    imagesDropped: Number.isFinite(item.imagesDropped) ? item.imagesDropped : 0,
    at: item.at,
  };
}

export interface RestoreResult {
  items: RestoredQueue[];
  /** Сколько картинок потеряно по всем репликам — для честного предупреждения. */
  lostImages: number;
  /** Сколько записей выброшено: битые или отправлять нечего. */
  skipped: number;
}

/**
 * Разобрать всё, что лежало в сторе `queue`: битые записи и реплики,
 * от которых остались только картинки, выбросить, порядок — по времени.
 */
export function readQueued(raw: unknown): RestoreResult {
  const result: RestoreResult = { items: [], lostImages: 0, skipped: 0 };
  if (!Array.isArray(raw)) return result;

  const byId = new Map<string, RestoredQueue>();
  for (const entry of raw) {
    if (!isPersistedQueue(entry)) {
      result.skipped += 1;
      continue;
    }
    const item = restoreQueued(entry);
    if (!item) {
      result.skipped += 1;
      continue;
    }
    // Один и тот же id дважды (обрыв записи) — оставляем более свежую запись.
    const previous = byId.get(item.id);
    if (previous && previous.at > item.at) {
      result.skipped += 1;
      continue;
    }
    if (previous) result.skipped += 1;
    byId.set(item.id, item);
    result.lostImages += item.imagesDropped;
    if (previous) result.lostImages -= previous.imagesDropped;
  }

  result.items = [...byId.values()].sort((a, b) => a.at - b.at);
  return result;
}
