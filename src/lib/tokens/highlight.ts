/**
 * Подложка поля ввода: где в тексте стоят токены.
 *
 * У textarea нельзя покрасить часть текста, поэтому под полем живёт слой
 * с тем же шрифтом и переносами: он и рисует фон под словами-токенами.
 * В режиме «значения» подсвечиваем место, которое токен занимает после
 * расшифровки, — иначе человек не видит, какие слова уже под защитой.
 *
 * Модуль чистый: подстановку значений передаём функцией, чтобы не тянуть
 * хранилище справочника в тесты и в другие экраны.
 */

import { tokenSpans } from "./occurrences";

export interface HighlightSegment {
  text: string;
  /** Слово — токен (в режиме значений — его расшифровка на месте токена). */
  token: boolean;
}

/**
 * Разбить черновик на куски «обычный текст / токен».
 *
 * `showValues` — поле показывает значения: токен заменяем его расшифровкой
 * через `restore`. Сумма текстов всегда равна видимому тексту поля.
 */
export function highlightSegments(
  tokenText: string,
  showValues: boolean,
  restore: (text: string) => string,
): HighlightSegment[] {
  const source = String(tokenText ?? "");
  const segments: HighlightSegment[] = [];
  let last = 0;
  for (const span of tokenSpans(source)) {
    if (span.start > last) {
      segments.push({ text: source.slice(last, span.start), token: false });
    }
    const raw = source.slice(span.start, span.end);
    const text = showValues ? String(restore(raw) ?? "") : raw;
    if (text) segments.push({ text, token: true });
    last = span.end;
  }
  if (last < source.length) {
    segments.push({ text: source.slice(last), token: false });
  }
  return segments;
}

/** Видимый текст, который должен получиться из этих кусков. */
export function segmentsText(segments: readonly HighlightSegment[]): string {
  return segments.map((segment) => segment.text).join("");
}
