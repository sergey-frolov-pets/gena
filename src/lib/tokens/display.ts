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

import { parseTokens, normalizeTokenName } from "./format";
import { replaceValues, restoreValues } from "./registry";

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
): string {
  if (!showValues) return tokenText;
  const source = String(tokenText ?? "");
  if (!source.includes("⟦")) return restoreValues(source);
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
    out += form && form.trim() ? form : restoreValues(token.raw);
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
): string {
  if (!showValues) return visible;
  return replaceValues(visible, onHit).text;
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
