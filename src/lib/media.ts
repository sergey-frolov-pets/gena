/**
 * Приём вложений от агента Pico.
 *
 * Сервер отдаёт вложения как `message.create.payload.attachments:
 * [{ type, url, filename, content_type }]`, где `url` — относительный путь
 * `/pico/media/<ref>`, требующий `Authorization`. Поэтому в `<img src>` его
 * подставить нельзя: сначала авторизованный `fetch` → `blob:` URL (кеш в памяти
 * сессии), затем миниатюра в IndexedDB.
 *
 * В историю кладём только миниатюру и `refUrl` — во время следующей сессии
 * полный размер при необходимости догружается заново.
 *
 * Документы (`type: "file"`) не скачиваются заранее: в истории остаётся имя,
 * размер и `refUrl`, а байты тянутся авторизованным `fetch` по клику.
 */

import type { MessageAttachment } from "@/storage/types";
import { makeThumb } from "./images";

export interface IncomingAttachment {
  /** Путь на сервере (`/pico/media/<ref>`). */
  url: string;
  filename?: string;
  contentType?: string;
  /** `image` или `file` — как объявил сервер. */
  kind: "image" | "file";
  /** Размер в байтах, если сервер прислал. */
  bytes?: number;
}

/** Разобрать `payload.attachments`; мусор без url отбрасывается. */
export function parseIncomingAttachments(raw: unknown): IncomingAttachment[] {
  if (!Array.isArray(raw)) return [];
  const result: IncomingAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const url = typeof obj.url === "string" ? obj.url.trim() : "";
    if (!url) continue;
    const contentType = typeof obj.content_type === "string" ? obj.content_type : undefined;
    const type = typeof obj.type === "string" ? obj.type.trim().toLowerCase() : "";
    // Сервер помечает картинки `image`, всё остальное — `file`/`audio`/`video`.
    // Аудио и видео пока не показываем, но и не ломаемся: считаем их файлами.
    const kind: "image" | "file" =
      type === "image" || (!type && Boolean(contentType?.startsWith("image/"))) ? "image" : "file";
    const bytes = typeof obj.bytes === "number" && obj.bytes >= 0 ? obj.bytes : undefined;
    result.push({
      url,
      filename: typeof obj.filename === "string" ? obj.filename : undefined,
      contentType,
      kind,
      bytes,
    });
  }
  return result;
}

/** Абсолютный URL медиа: ws(s) в адресе агента → http(s). */
export function absoluteMediaUrl(address: string, path: string): string {
  const trimmed = address.trim();
  if (!trimmed) throw new Error("agent address is empty");
  const http = trimmed.replace(/^ws(s?):\/\//i, "http$1://");
  const base = new URL(http);
  const root = `${base.protocol}//${base.host}/`;
  return new URL(path.replace(/^\/+/, "/"), root).toString();
}

/** Кеш скачанных изображений: абсолютный URL → blob-URL. */
const blobCache = new Map<string, string>();

/** Уже скачанный blob-URL (или undefined). */
export function getCachedMedia(address: string, path: string): string | undefined {
  try {
    return blobCache.get(absoluteMediaUrl(address, path));
  } catch {
    return undefined;
  }
}

/** Освободить кеш (например, при выходе из чата). */
export function clearMediaCache(): void {
  for (const url of blobCache.values()) {
    URL.revokeObjectURL(url);
  }
  blobCache.clear();
}

/** Скачать изображение с авторизацией; повторный запрос берётся из кеша. */
export async function fetchMediaBlob(
  address: string,
  apiKey: string,
  path: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const absolute = absoluteMediaUrl(address, path);
  const cached = blobCache.get(absolute);
  if (cached) return cached;

  const response = await fetchImpl(absolute, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(`media request failed: ${response.status}`);
  }
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) {
    throw new Error("attachment is not an image");
  }
  const blobUrl = URL.createObjectURL(blob);
  blobCache.set(absolute, blobUrl);
  return blobUrl;
}

/** Входящее вложение → запись для истории (миниатюра + путь для догрузки). */
export async function attachmentFromBlobUrl(
  blobUrl: string,
  refUrl: string,
): Promise<MessageAttachment> {
  const { thumb, width, height } = await makeThumb(blobUrl);
  return { kind: "image", thumb, width, height, refUrl };
}

/** Входящий документ → запись истории без загрузки байтов. */
export function fileAttachmentFromIncoming(item: IncomingAttachment): MessageAttachment {
  return {
    kind: "file",
    name: item.filename?.trim() || "file",
    bytes: item.bytes,
    refUrl: item.url,
  };
}

/**
 * Скачать документ с авторизацией и отдать браузеру как файл.
 *
 * В истории лежит только `refUrl`, поэтому байты тянутся в момент клика:
 * ответ → blob → временная ссылка → `a.download`.
 */
export async function downloadMediaFile(
  address: string,
  apiKey: string,
  path: string,
  filename: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const absolute = absoluteMediaUrl(address, path);
  const response = await fetchImpl(absolute, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(`media request failed: ${response.status}`);
  }
  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = filename || "file";
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // Дать браузеру время начать загрузку, затем освободить память.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
  }
}
