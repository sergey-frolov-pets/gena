/**
 * Защита на уровне подключения.
 *
 * В «Подключениях» у агента есть флаг «Только режим токенов»: диалоги этого
 * агента всегда защищённые, и снять защиту из чата нельзя — только здесь.
 *
 * Старые незащищённые диалоги такого агента задним числом не переписываются:
 * история остаётся как была, но новые сообщения пишутся токенами, а кнопка
 * снятия защиты объясняет, где снимается ограничение.
 */

export interface TokenOnlyAgent {
  tokenOnly?: boolean;
}

/** Агент требует защищённый режим во всех своих диалогах. */
export function agentRequiresTokens(agent?: TokenOnlyAgent | null): boolean {
  return agent?.tokenOnly === true;
}

/** Почему режим токенов нельзя выключить в этом диалоге. */
export type TokenModeLock = "agent" | "links" | null;

/**
 * Замок снятия защиты: подключение агента сильнее локальных связей —
 * если флаг стоит, объясняем именно его, а не пары «значение — токен».
 */
export function tokenModeLockReason(
  linkedNames: readonly string[],
  agentLocked: boolean,
): TokenModeLock {
  if (agentLocked) return "agent";
  if (linkedNames.length > 0) return "links";
  return null;
}
