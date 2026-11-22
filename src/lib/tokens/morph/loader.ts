/**
 * Загрузка файла словаря по сети.
 *
 * Словарь качается один раз и дальше живёт в базе устройства: сеть нужна
 * только для первого скачивания и для обновления. Прогресс отдаётся наружу,
 * чтобы интерфейс не выглядел замершим на файле в сотни килобайт.
 */

import {
  MORPH_MAX_BYTES,
  MorphFileError,
  readMorphJson,
  type MorphDictionary,
} from "./format";

/**
 * Откуда берём словарь. Файл лежит рядом с приложением (`public/morph`),
 * поэтому работает и на GitHub Pages, и в локальной сборке.
 */
export const MORPH_URL = `${import.meta.env.BASE_URL}morph/ru-morph-v1.json`;

export type MorphLoadErrorCode = "network" | "http" | "bad_file" | "too_big" | "aborted";

export class MorphLoadError extends Error {
  readonly code: MorphLoadErrorCode;

  constructor(code: MorphLoadErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "MorphLoadError";
    this.code = code;
  }
}

export interface FetchMorphOptions {
  url?: string;
  signal?: AbortSignal;
  /** `total` = 0, если сервер не прислал `Content-Length`. */
  onProgress?: (loaded: number, total: number) => void;
}

export interface FetchMorphResult {
  dictionary: MorphDictionary;
  bytes: number;
}

function isAbort(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

async function readText(response: Response, onProgress?: FetchMorphOptions["onProgress"]): Promise<string> {
  const total = Number(response.headers.get("content-length") ?? 0);
  const body = response.body;
  if (!body || typeof body.getReader !== "function") {
    const text = await response.text();
    onProgress?.(text.length, text.length);
    return text;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    loaded += value.byteLength;
    if (loaded > MORPH_MAX_BYTES) {
      void reader.cancel();
      throw new MorphLoadError("too_big", String(loaded));
    }
    chunks.push(value);
    onProgress?.(loaded, total);
  }
  const joined = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(joined);
}

/** Скачать и проверить словарь. Бросает `MorphLoadError`. */
export async function fetchMorphDictionary(options: FetchMorphOptions = {}): Promise<FetchMorphResult> {
  const url = options.url ?? MORPH_URL;
  let response: Response;
  try {
    response = await fetch(url, { signal: options.signal, cache: "no-cache" });
  } catch (error) {
    if (isAbort(error)) throw new MorphLoadError("aborted");
    throw new MorphLoadError("network");
  }
  if (!response.ok) throw new MorphLoadError("http", `HTTP ${response.status}`);

  let text: string;
  try {
    text = await readText(response, options.onProgress);
  } catch (error) {
    if (error instanceof MorphLoadError) throw error;
    if (isAbort(error)) throw new MorphLoadError("aborted");
    throw new MorphLoadError("network");
  }

  const bytes = new TextEncoder().encode(text).byteLength;
  try {
    return { dictionary: readMorphJson(text), bytes };
  } catch (error) {
    const code = error instanceof MorphFileError ? error.code : "bad_json";
    throw new MorphLoadError("bad_file", code);
  }
}
