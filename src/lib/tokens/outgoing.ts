/**
 * Что уходит агенту.
 *
 * Жёсткое правило продукта: настоящие значения справочника не покидают
 * устройство. Агент — и любая модель за ним — видит только токены ⟦имя⟧,
 * а значения подставляются в интерфейсе Gena.
 *
 * Здесь единственное место, где текст готовится к отправке: новая реплика,
 * очередь, догон незавершённого хода, «повторить ответ», вложения. Если
 * подстановку забыть в одном месте — значение уйдёт агенту, поэтому все
 * пути обязаны идти через `forAgent` / `historyForAgent`.
 */

import { replaceValues, tokensBroken, tokensLoaded } from "./registry";

/** Справочник прочитан и все записи расшифрованы — можно гарантировать подстановку. */
export function tokensReady(): boolean {
  return tokensLoaded.value && tokensBroken.value === 0;
}

/** Текст для агента: значения заменяются токенами. Уже стоящие токены не ломаются. */
export function forAgent(text: string): string {
  if (!text) return text;
  return replaceValues(text).text;
}

/**
 * Контекст для модели: подстановка применяется и к старым сообщениям —
 * диалог мог начинаться до появления справочника или до режима токенов.
 */
export function historyForAgent<T extends { content: string }>(list: readonly T[]): T[] {
  return list.map((item) => ({ ...item, content: forAgent(item.content) }));
}
