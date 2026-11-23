/**
 * Поле ввода в режиме токенов: что человек видит и что лежит в черновике.
 *
 * Черновик всегда хранит токены — он уходит в localStorage, в очередь реплик
 * и в историю, а значениям там не место. На экране же человек выбирает сам:
 * читать значения или ровно то, что увидит агент. Перекодировка идёт на входе
 * и выходе поля, поэтому замена, вхождения и каретка считаются в координатах
 * черновика одинаково при любом режиме просмотра.
 */

import { replaceValues, restoreValues } from "./registry";

/** Текст для показа в поле: значения (расшифровка) или сами токены. */
export function visibleText(tokenText: string, showValues: boolean): string {
  return showValues ? restoreValues(tokenText) : tokenText;
}

/** Текст из поля → черновик: в режиме значений обратно в токены. */
export function draftText(visible: string, showValues: boolean): string {
  return showValues ? replaceValues(visible).text : visible;
}

/**
 * Смещение каретки из видимого текста в черновик.
 *
 * Считаем по префиксу: то, что человек уже набрал до каретки, перекодируется
 * тем же движком, и длина префикса в токенах даёт позицию в черновике.
 */
export function toDraftCaret(visible: string, offset: number, showValues: boolean): number {
  if (!showValues) return offset;
  return replaceValues(visible.slice(0, offset)).text.length;
}

/** Смещение каретки из черновика в видимый текст (обратная перекодировка). */
export function toVisibleCaret(tokenText: string, offset: number, showValues: boolean): number {
  if (!showValues) return offset;
  return restoreValues(tokenText.slice(0, offset)).length;
}
