/**
 * Подготовка изображений к отправке агенту Pico.
 *
 * Сервер принимает только изображения (JPEG, PNG, GIF, WebP, BMP) в виде
 * data-URL в `payload.media`, до 20 МБ на файл. Отправлять оригинал с телефона
 * (5–8 МБ) бессмысленно: он раздувает контекст и мобильный трафик.
 * Поэтому уменьшаем длинную сторону до 1600 px и подбираем кодирование так,
 * чтобы уложиться в ~1.5 МБ; PNG с прозрачностью по возможности оставляем PNG.
 *
 * В IndexedDB кладём только миниатюру (≤ 200 px) — полный data-URL живёт
 * в памяти до отправки.
 */

export type ImageErrorCode = "unsupported" | "too_large" | "decode";

export class ImageError extends Error {
  readonly code: ImageErrorCode;

  constructor(code: ImageErrorCode) {
    super(code);
    this.name = "ImageError";
    this.code = code;
  }
}

export interface PreparedImage {
  /** Полный data-URL — уходит на сервер и НЕ сохраняется в историю. */
  dataUrl: string;
  /** Миниатюра для IndexedDB. */
  thumb: string;
  width: number;
  height: number;
  /** Приблизительный размер закодированных данных, байт. */
  bytes: number;
}

const MAX_SIDE = 1600;
const FALLBACK_SIDE = 1000;
const THUMB_SIDE = 200;
/** Лимит сервера на изображение. */
const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Целевой размер после сжатия. */
const TARGET_BYTES = 1.5 * 1024 * 1024;
const JPEG_QUALITY = 0.85;
const THUMB_QUALITY = 0.8;

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
]);

/** Грубая оценка размера data-URL без декодирования. */
export function approxBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const body = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Math.floor((body.length * 3) / 4);
}

function fit(width: number, height: number, maxSide: number): { w: number; h: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { w: width, h: height };
  const k = maxSide / longest;
  return { w: Math.max(1, Math.round(width * k)), h: Math.max(1, Math.round(height * k)) };
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new ImageError("decode"));
    reader.readAsDataURL(blob);
  });
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new ImageError("decode"));
    img.src = url;
  });
}

function draw(img: HTMLImageElement, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageError("decode");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);
  return canvas;
}

/**
 * Готовит файл к отправке: проверяет тип и размер, уменьшает и кодирует.
 * Бросает ImageError с кодом для локализованного сообщения.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!ALLOWED_TYPES.has(file.type)) throw new ImageError("unsupported");
  if (file.size > MAX_FILE_BYTES) throw new ImageError("too_large");

  const url = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(url);
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (!width || !height) throw new ImageError("decode");

    const full = fit(width, height, MAX_SIDE);
    const thumbBox = fit(width, height, THUMB_SIDE);
    // Миниатюра: PNG сохраняет прозрачность, JPEG — меньше по размеру.
    const thumbMime = file.type === "image/jpeg" ? "image/jpeg" : "image/png";
    const thumb = draw(img, thumbBox.w, thumbBox.h).toDataURL(thumbMime, THUMB_QUALITY);

    // GIF не перекодируем — иначе умрёт анимация.
    if (file.type === "image/gif" && file.size <= TARGET_BYTES) {
      return {
        dataUrl: await readAsDataUrl(file),
        thumb,
        width: full.w,
        height: full.h,
        bytes: file.size,
      };
    }

    let dataUrl = draw(img, full.w, full.h).toDataURL(
      file.type === "image/png" ? "image/png" : "image/jpeg",
      JPEG_QUALITY,
    );

    if (approxBytes(dataUrl) > TARGET_BYTES && file.type === "image/png") {
      // PNG не влез — переходим на JPEG (прозрачность станет белой).
      dataUrl = draw(img, full.w, full.h).toDataURL("image/jpeg", JPEG_QUALITY);
    }
    if (approxBytes(dataUrl) > TARGET_BYTES) {
      const smaller = fit(width, height, FALLBACK_SIDE);
      dataUrl = draw(img, smaller.w, smaller.h).toDataURL("image/jpeg", THUMB_QUALITY);
    }

    return {
      dataUrl,
      thumb,
      width: full.w,
      height: full.h,
      bytes: approxBytes(dataUrl),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
