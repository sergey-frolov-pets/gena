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
import { normalizeTokenName } from "./format";

export interface HighlightSegment {
  text: string;
  /** Слово — токен (в режиме значений — его расшифровка на месте токена). */
  token: boolean;
  /** Значение справочника ещё открытым текстом: его можно заменить или отклонить. */
  offer?: boolean;
}

/**
 * Разбить черновик на куски «обычный текст / токен».
 *
 * `showValues` — поле показывает значения: токен заменяем его расшифровкой
 * через `restore`. Третьим аргументом идут имя токена и номер его вхождения
 * среди одноимённых: расшифровка может зависеть от места («вклада ВТБ» в одном
 * месте и «вклад ВТБ» в другом), поэтому одной функции «токен → значение»
 * недостаточно. Сумма текстов всегда равна видимому тексту поля.
 */
export function highlightSegments(
  tokenText: string,
  showValues: boolean,
  restore: (text: string, name: string, index: number) => string,
  offers: readonly { start: number; end: number }[] = [],
): HighlightSegment[] {
  const source = String(tokenText ?? "");
  const tokens = tokenSpans(source);
  const marks: { start: number; end: number; token: boolean }[] = [];
  for (const span of tokens) marks.push({ start: span.start, end: span.end, token: true });
  for (const span of offers) {
    if (span.end <= span.start) continue;
    if (tokens.some((token) => span.start < token.end && span.end > token.start)) continue;
    marks.push({ start: span.start, end: span.end, token: false });
  }
  marks.sort((a, b) => a.start - b.start || Number(b.token) - Number(a.token));
  const segments: HighlightSegment[] = [];
  const counters = new Map<string, number>();
  let last = 0;
  for (const span of marks) {
    if (span.start < last) continue;
    if (span.start > last) {
      segments.push({ text: source.slice(last, span.start), token: false });
    }
    const raw = source.slice(span.start, span.end);
    if (!span.token) {
      if (raw) segments.push({ text: raw, token: false, offer: true });
    } else {
      const name = normalizeTokenName(raw.slice(1, -1));
      const key = name.toLocaleLowerCase();
      const index = counters.get(key) ?? 0;
      counters.set(key, index + 1);
      const text = showValues ? String(restore(raw, name, index) ?? "") : raw;
      if (text) segments.push({ text, token: true });
    }
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

function escapeChat(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Текст сообщения с подсветкой токенов и ещё не заменённых значений.
 *
 * Спан переживает markdown: класс `md-*`, координаты — в исходном тексте,
 * чтобы клик в ленте открыл то же облачко, что и клик в поле ввода.
 */
export function markChatHtml(
  tokenText: string,
  showValues: boolean,
  restore: (raw: string, name: string, index: number) => string,
  offers: readonly { start: number; end: number; name: string }[] = [],
): string {
  const source = String(tokenText ?? "");
  const tokens = tokenSpans(source);
  const marks: { start: number; end: number; token: boolean; name: string }[] = [];
  for (const span of tokens) {
    const raw = source.slice(span.start, span.end);
    const name = normalizeTokenName(raw.slice(1, -1));
    marks.push({ start: span.start, end: span.end, token: true, name });
  }
  for (const span of offers) {
    if (span.end <= span.start) continue;
    if (tokens.some((token) => span.start < token.end && span.end > token.start)) continue;
    marks.push({ start: span.start, end: span.end, token: false, name: span.name });
  }
  marks.sort((a, b) => a.start - b.start || Number(b.token) - Number(a.token));
  const counters = new Map<string, number>();
  let html = "";
  let last = 0;
  for (const span of marks) {
    if (span.start < last) continue;
    if (span.start > last) html += escapeChat(source.slice(last, span.start));
    const raw = source.slice(span.start, span.end);
    let text = raw;
    if (span.token && showValues) {
      const key = span.name.toLocaleLowerCase();
      const index = counters.get(key) ?? 0;
      counters.set(key, index + 1);
      text = String(restore(raw, span.name, index) ?? "");
    }
    const klass = span.token ? "md-token" : "md-offer";
    const name = escapeChat(span.name);
    html += `<span class="${klass}" data-name="${name}" data-start="${span.start}" data-end="${span.end}">${escapeChat(text)}</span>`;
    last = span.end;
  }
  if (last < source.length) html += escapeChat(source.slice(last));
  return html;
}
