/**
 * Замена выделенного фрагмента в тексте сообщения токеном.
 *
 * В ленте человек выделяет то, что видит: значение («Иван Петров») или готовый
 * токен. Меняем ровно одно, первое разрешённое вхождение — вхождения внутри
 * другого токена и внутри слова не трогаем, иначе текст превращается в кашу.
 * Сама функция чистая: хранилище, режим токенов и правку сообщения решает экран.
 */

import { formatToken } from "./format";
import { findOccurrences, replaceSpan } from "./occurrences";

export interface MessageReplaceResult {
  /** Новый текст сообщения. */
  text: string;
  /** Замена состоялась: в тексте нашлось разрешённое вхождение. */
  replaced: boolean;
}

/**
 * Заменить первое разрешённое вхождение `needle` токеном `⟦name⟧`.
 *
 * Возвращает исходный текст и `replaced: false`, если вхождения нет или все
 * они заблокированы (внутри слова, внутри токена) — вызывающий код тогда
 * ничего не пишет в историю.
 */
export function replaceSelectionWithToken(
  text: string,
  needle: string,
  name: string,
): MessageReplaceResult {
  const source = String(text ?? "");
  const fragment = String(needle ?? "").trim();
  const tokenName = String(name ?? "").trim();
  if (!source || !fragment || !tokenName) {
    return { text: source, replaced: false };
  }
  const hit = findOccurrences(source, fragment).find((item) => !item.blocked);
  if (!hit) return { text: source, replaced: false };
  return {
    text: replaceSpan(source, hit.start, hit.end, formatToken(tokenName)),
    replaced: true,
  };
}
