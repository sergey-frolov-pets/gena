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
 *
 * Медиа-запрос идёт не «в домен агента», а по списку кандидатов: сначала свой
 * домен страницы (same-origin, CORS не нужен), потом домен агента. Так вложение
 * работает и когда страница живёт на одном хосте, а Pico — на другом.
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

/** Домен, с которого медиа тянется первым (задаётся при сборке). */
const ENV_MEDIA_ORIGIN = (
  (import.meta.env?.VITE_MEDIA_ORIGIN as string | undefined) ?? ""
).trim();

/** Origin текущей страницы (`""` вне браузера — в тестах). */
function currentOrigin(): string {
  return typeof window === "undefined" ? "" : window.location.origin;
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

/**
 * Куда пробуем сходить за вложением, по порядку.
 *
 * 1. `VITE_MEDIA_ORIGIN` — домен, назначенный при сборке;
 * 2. origin страницы — обычно same-origin, без CORS и preflight;
 * 3. домен агента — последний шанс (и единственный в dev-сервере без прокси).
 */
export function mediaUrlCandidates(
  address: string,
  path: string,
  pageOrigin: string = currentOrigin(),
): string[] {
  const relative = path.replace(/^\/+/, "/");
  const urls: string[] = [];
  const add = (url: string) => {
    if (!urls.includes(url)) urls.push(url);
  };
  for (const origin of [ENV_MEDIA_ORIGIN, pageOrigin]) {
    if (!origin) continue;
    try {
      add(new URL(relative, origin).toString());
    } catch {
      // Некорректный origin — просто пропускаем.
    }
  }
  add(absoluteMediaUrl(address, path));
  return urls;
}

/** Ключ кеша: не зависит от того, какой домен ответил первым. */
function cacheKey(address: string, path: string): string {
  return `${address.trim()}|${path}`;
}

/** Кеш скачанных изображений: адрес агента + путь → blob-URL. */
const blobCache = new Map<string, string>();

/** Уже скачанный blob-URL (или undefined). */
export function getCachedMedia(address: string, path: string): string | undefined {
  return blobCache.get(cacheKey(address, path));
}

/** Освободить кеш (например, при выходе из чата). */
export function clearMediaCache(): void {
  for (const url of blobCache.values()) {
    URL.revokeObjectURL(url);
  }
  blobCache.clear();
}

/** Ответ по первому адресу из списка, который ответил `2xx`. */
async function fetchFirstOk(
  address: string,
  apiKey: string,
  path: string,
  fetchImpl: typeof fetch,
  pageOrigin?: string,
): Promise<{ response: Response; url: string }> {
  let failure: unknown = new Error("media request failed");
  for (const url of mediaUrlCandidates(address, path, pageOrigin)) {
    try {
      const response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (response.ok) return { response, url };
      failure = new Error(`media request failed: ${response.status}`);
    } catch (error) {
      failure = error;
    }
  }
  throw failure instanceof Error ? failure : new Error("media request failed");
}

/** Скачать изображение с авторизацией; повторный запрос берётся из кеша. */
export async function fetchMediaBlob(
  address: string,
  apiKey: string,
  path: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const key = cacheKey(address, path);
  const cached = blobCache.get(key);
  if (cached) return cached;

  const { response } = await fetchFirstOk(address, apiKey, path, fetchImpl);
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) {
    throw new Error("attachment is not an image");
  }
  const blobUrl = URL.createObjectURL(blob);
  blobCache.set(key, blobUrl);
  return blobUrl;
}

/** Входящее вложение → запись для истории (миниатюра + путь для догрузки). */
export async function attachmentFromBlobUrl(
  blobUrl: string,
  refUrl: string,
  meta: { name?: string; mime?: string } = {},
): Promise<MessageAttachment> {
  const { thumb, width, height } = await makeThumb(blobUrl);
  return { kind: "image", thumb, width, height, refUrl, name: meta.name, mime: meta.mime };
}

/** Входящий документ → запись истории без загрузки байтов. */
export function fileAttachmentFromIncoming(item: IncomingAttachment): MessageAttachment {
  return {
    kind: "file",
    name: item.filename?.trim() || "file",
    bytes: item.bytes,
    refUrl: item.url,
    mime: item.contentType,
  };
}

/** Расширение по MIME: нужно, когда сервер не прислал имя файла. */
const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/svg+xml": "svg",
  "text/markdown": "md",
  "text/plain": "txt",
  "text/csv": "csv",
  "text/tab-separated-values": "tsv",
  "application/json": "json",
  "application/pdf": "pdf",
  "application/zip": "zip",
  "application/gzip": "gz",
  "application/xml": "xml",
  "text/yaml": "yml",
  "application/x-yaml": "yml",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

/** `Content-Disposition` → имя файла (учитывает `filename*=UTF-8''…`). */
export function filenameFromDisposition(header: string | null | undefined): string | undefined {
  if (!header) return undefined;
  const extended = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (extended) {
    try {
      return decodeURIComponent(extended[2].trim());
    } catch {
      return extended[2].trim();
    }
  }
  const plain = /filename\s*=\s*"([^"]*)"|filename\s*=\s*([^;]+)/i.exec(header);
  const name = (plain?.[1] ?? plain?.[2] ?? "").trim();
  return name || undefined;
}

/**
 * Дописать расширение по MIME, если его нет или оно врёт (`.bin`).
 *
 * Браузер сам расширение не придумывает: без `download`-имени картинка из
 * blob-ссылки сохранялась как `<uuid>.bin`.
 */
export function withExtension(name: string, mime: string): string {
  const clean = (name || "").trim() || "file";
  const base = mime.split(";")[0].trim().toLowerCase();
  const known = MIME_EXTENSIONS[base];
  if (!known) return clean;
  const match = /\.([a-z0-9]{1,8})$/i.exec(clean);
  if (!match) return `${clean}.${known}`;
  const ext = match[1].toLowerCase();
  const aliases: Record<string, string[]> = { jpg: ["jpeg", "jpg"], md: ["md", "markdown"], yml: ["yml", "yaml"] };
  const allowed = aliases[known] ?? [known];
  return allowed.includes(ext) ? clean : clean.replace(/\.[a-z0-9]{1,8}$/i, `.${known}`);
}

/** Имя по умолчанию, если ни сервер, ни адрес его не дали. */
function fallbackName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() || "file");
  } catch {
    return "file";
  }
}

/** Сколько ждать записи blob, прежде чем освободить ссылку. */
const REVOKE_DELAY_MS = 10_000;

/**
 * Итоговое имя файла для сохранения или отправки.
 *
 * Порядок: явное имя из записи → `Content-Disposition` → имя из адреса;
 * затем расширение правится по MIME, если его нет или оно врёт (`.bin`).
 */
export function resolveAttachmentName(
  filename: string,
  disposition: string | null | undefined,
  url: string,
  mime: string,
): string {
  return withExtension(
    filename.trim() || filenameFromDisposition(disposition) || fallbackName(url),
    mime,
  );
}

/** Отдать blob браузеру как файл с нужным именем. */
export function saveBlob(blob: Blob, filename: string): void {
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
    setTimeout(() => URL.revokeObjectURL(blobUrl), REVOKE_DELAY_MS);
  }
}

/** Итог «поделиться»: системное меню, отмена человеком или браузер не умеет. */
export type ShareResult = "shared" | "cancelled" | "unsupported";

/** Скачать вложение (картинку или документ) под правильным именем. */
export async function downloadMediaFile(
  address: string,
  apiKey: string,
  path: string,
  filename: string = "",
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const { response, url } = await fetchFirstOk(address, apiKey, path, fetchImpl);
  const blob = await response.blob();
  const mime = blob.type || response.headers.get("Content-Type") || "";
  const name = resolveAttachmentName(
    filename,
    response.headers.get("Content-Disposition"),
    url,
    mime,
  );
  saveBlob(blob, name);
  return name;
}

/**
 * Отдать вложение в системное меню «Поделиться» (`navigator.share` + файл).
 *
 * Работает только в браузерах с Web Share API уровня файлов и только по HTTPS.
 * `unsupported` — вызывающая сторона откатывается на обычное скачивание.
 */
export async function shareMediaFile(
  address: string,
  apiKey: string,
  path: string,
  filename: string = "",
  fetchImpl: typeof fetch = fetch,
): Promise<ShareResult> {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  if (!nav || typeof nav.share !== "function" || typeof File !== "function") {
    return "unsupported";
  }
  const { response, url } = await fetchFirstOk(address, apiKey, path, fetchImpl);
  const blob = await response.blob();
  const mime = blob.type || response.headers.get("Content-Type") || "application/octet-stream";
  const name = resolveAttachmentName(
    filename,
    response.headers.get("Content-Disposition"),
    url,
    mime,
  );
  const file = new File([blob], name, { type: mime });
  const payload: ShareData = { files: [file], title: name };
  if (typeof nav.canShare === "function" && !nav.canShare(payload)) {
    return "unsupported";
  }
  try {
    await nav.share(payload);
    return "shared";
  } catch (error) {
    // Человек закрыл меню — это не ошибка.
    if (error instanceof Error && error.name === "AbortError") return "cancelled";
    throw error;
  }
}

/** Предел размера для просмотра внутри чата: больше — только скачивание. */
export const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;

/**
 * Прочитать текстовое вложение (md, txt, csv, json…) без скачивания файла.
 *
 * Кодировка берётся из `Content-Type: …; charset=…`, по умолчанию UTF-8;
 * BOM снимается, иначе первый заголовок markdown не распознаётся.
 */
export async function fetchMediaText(
  address: string,
  apiKey: string,
  path: string,
  fetchImpl: typeof fetch = fetch,
  maxBytes: number = MAX_PREVIEW_BYTES,
): Promise<string> {
  const { response } = await fetchFirstOk(address, apiKey, path, fetchImpl);
  const blob = await response.blob();
  if (blob.size > maxBytes) {
    throw new Error("attachment is too large to preview");
  }
  const charset = /charset\s*=\s*"?([\w-]+)/i.exec(
    response.headers.get("Content-Type") ?? "",
  )?.[1];
  let text: string;
  if (charset && charset.toLowerCase() !== "utf-8" && typeof TextDecoder === "function") {
    try {
      text = new TextDecoder(charset).decode(await blob.arrayBuffer());
    } catch {
      text = await blob.text();
    }
  } else {
    text = await blob.text();
  }
  return text.replace(/^\uFEFF/, "");
}
