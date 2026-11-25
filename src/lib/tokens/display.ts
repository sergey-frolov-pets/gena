/**
 * Поле ввода в режиме токенов: что человек видит и что лежит в черновике.
 *
 * Черновик всегда хранит токены — он уходит в localStorage, в очередь реплик
 * и в историю, а значениям там не место. На экране же человек выбирает сам:
 * читать значения или ровно то, что увидит агент. Перекодировка идёт на входе
 * и выходе поля, поэтому замена, вхождения и каретка считаются в координатах
 * черновика одинаково при любом режиме просмотра.
 *
 * Показ значений — не канон справочника, а то, что человек написал: «вклада
 * ВТБ» вернётся «вклада ВТБ», а не «вклад ВТБ». Падеж и регистр — часть текста,
 * а не часть записи. Форму подсказывает `formFor`: имя + номер вхождения.
 */

import { parseTokens, normalizeTokenName, tokensToValues, type TokenLookup } from "./format";
import { replaceValues, restoreValues, type TokenEntry } from "./registry";

/** Исходная форма токена: имя и номер вхождения среди одноимённых. */
export type FormLookup = (name: string, index: number) => string | null;

/**
 * Текст для показа в поле: значения (расшифровка) или сами токены.
 *
 * С `formFor` одноимённые токены получают каждый свою форму — той, что была
 * в тексте до замены. Нет формы — канон записи.
 */
export function visibleText(
  tokenText: string,
  showValues: boolean,
  formFor?: FormLookup,
  lookup?: TokenLookup,
): string {
  const read = (raw: string) => (lookup ? tokensToValues(raw, lookup) : restoreValues(raw));
  if (!showValues) return tokenText;
  const source = String(tokenText ?? "");
  if (!source.includes("⟦")) return read(source);
  const tokens = parseTokens(source);
  if (tokens.length === 0) return source;
  const counters = new Map<string, number>();
  let out = "";
  let from = 0;
  for (const token of tokens) {
    out += source.slice(from, token.start);
    const key = normalizeTokenName(token.name).toLocaleLowerCase();
    const index = counters.get(key) ?? 0;
    counters.set(key, index + 1);
    const form = formFor?.(token.name, index) ?? null;
    out += form && form.trim() ? form : read(token.raw);
    from = token.end;
  }
  return out + source.slice(from);
}

/**
 * Текст из поля → черновик: в режиме значений обратно в токены.
 *
 * `onHit` сообщает, какое написание стало токеном: по нему поле помнит
 * исходные формы, чтобы переключение «значения ⇄ токены» ничего не теряло.
 */
export function draftText(
  visible: string,
  showValues: boolean,
  onHit?: (hit: { name: string; form: string }) => void,
  entries?: readonly TokenEntry[],
): string {
  if (!showValues) return visible;
  return replaceValues(visible, onHit, entries).text;
}

/**
 * Смещение каретки из видимого текста в черновик.
 *
 * Считаем по префиксу: то, что человек уже набрал до каретки, перекодируется
 * тем же движком, и длина префикса в токенах даёт позицию в черновике.
 */
export function toDraftCaret(
  visible: string,
  offset: number,
  showValues: boolean,
  entries?: readonly TokenEntry[],
): number {
  if (!showValues) return offset;
  return replaceValues(visible.slice(0, offset), undefined, entries).text.length;
}

/** Смещение каретки из черновика в видимый текст (обратная перекодировка). */
export function toVisibleCaret(tokenText: string, offset: number, showValues: boolean): number {
  if (!showValues) return offset;
  return restoreValues(tokenText.slice(0, offset)).length;
}

interface VisiblePiece {
  draftStart: number;
  draftEnd: number;
  visibleStart: number;
  visibleEnd: number;
  token: boolean;
}

/**
 * Куски видимого текста в тех же координатах, что и подсветка поля.
 *
 * Форма вхождения может быть длиннее или короче и токена, и канона
 * справочника. Клик по подсветке считается по этим кускам, а не по
 * перекодировке префикса: иначе каретка промахивается мимо ⟦токена⟧.
 */
export function visiblePieces(
  tokenText: string,
  showValues: boolean,
  formFor?: FormLookup,
  lookup?: TokenLookup,
): VisiblePiece[] {
  const source = String(tokenText ?? "");
  if (!showValues) {
    return source
      ? [{ draftStart: 0, draftEnd: source.length, visibleStart: 0, visibleEnd: source.length, token: false }]
      : [];
  }
  const tokens = parseTokens(source);
  const pieces: VisiblePiece[] = [];
  const counters = new Map<string, number>();
  let draftFrom = 0;
  let visibleFrom = 0;
  for (const token of tokens) {
    if (token.start > draftFrom) {
      const gap = source.slice(draftFrom, token.start);
      pieces.push({
        draftStart: draftFrom,
        draftEnd: token.start,
        visibleStart: visibleFrom,
        visibleEnd: visibleFrom + gap.length,
        token: false,
      });
      visibleFrom += gap.length;
    }
    const key = normalizeTokenName(token.name).toLocaleLowerCase();
    const index = counters.get(key) ?? 0;
    counters.set(key, index + 1);
    const form = formFor?.(token.name, index) ?? null;
    const read = lookup ? tokensToValues(token.raw, lookup) : restoreValues(token.raw);
    const shown = form && form.trim() ? form : read;
    pieces.push({
      draftStart: token.start,
      draftEnd: token.end,
      visibleStart: visibleFrom,
      visibleEnd: visibleFrom + shown.length,
      token: true,
    });
    visibleFrom += shown.length;
    draftFrom = token.end;
  }
  if (draftFrom < source.length) {
    const gap = source.slice(draftFrom);
    pieces.push({
      draftStart: draftFrom,
      draftEnd: source.length,
      visibleStart: visibleFrom,
      visibleEnd: visibleFrom + gap.length,
      token: false,
    });
  }
  return pieces;
}

/**
 * Клик по видимому тексту → позиция в черновике.
 *
 * Попадание в показанную форму токена возвращает точку внутри ⟦токена⟧,
 * даже если форма длиннее самого токена.
 */
export function draftOffsetForVisible(
  tokenText: string,
  visibleOffset: number,
  showValues: boolean,
  formFor?: FormLookup,
  lookup?: TokenLookup,
): number {
  const source = String(tokenText ?? "");
  const at = Math.max(0, Math.trunc(visibleOffset) || 0);
  if (!showValues) return Math.min(at, source.length);
  const pieces = visiblePieces(source, true, formFor, lookup);
  for (const piece of pieces) {
    if (at < piece.visibleStart || at > piece.visibleEnd) continue;
    if (piece.token) {
      if (at <= piece.visibleStart) return piece.draftStart;
      return Math.max(piece.draftStart, piece.draftEnd - 1);
    }
    return piece.draftStart + (at - piece.visibleStart);
  }
  return source.length;
}

/** Начало видимого слова для позиции в черновике — куда ставить облачко. */
export function visibleOffsetForDraft(
  tokenText: string,
  draftOffset: number,
  showValues: boolean,
  formFor?: FormLookup,
  lookup?: TokenLookup,
): number {
  const source = String(tokenText ?? "");
  const at = Math.max(0, Math.trunc(draftOffset) || 0);
  if (!showValues) return Math.min(at, source.length);
  const pieces = visiblePieces(source, true, formFor, lookup);
  for (const piece of pieces) {
    if (at < piece.draftStart || at > piece.draftEnd) continue;
    // Конец куска — конец показанной формы. Иначе каретка конца токена
    // остаётся на его начале, и выделение захватывает текст следующей строки.
    if (at === piece.draftEnd) return piece.visibleEnd;
    if (piece.token) return piece.visibleStart;
    return piece.visibleStart + (at - piece.draftStart);
  }
  const last = pieces[pieces.length - 1];
  return last ? last.visibleEnd : 0;
}
