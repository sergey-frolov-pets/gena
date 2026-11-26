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
 *
 * Второй аргумент `context` — для журнала отправок (M2): кто, куда, в каком
 * режиме. Пишутся только метаданные, содержимое не сохраняется.
 */

import { isTrustedProvider, providerHost, resolvePrivacyMode } from "@/lib/privacy/mode";
import { trustedProviders } from "@/lib/privacy/trusted-providers";
import { recordAudit } from "@/storage/audit";
import type { PrivacyMode } from "@/storage/types";

import { replaceValues, tokensBroken, tokensLoaded } from "./registry";

/** Справочник прочитан и все записи расшифрованы — можно гарантировать подстановку. */
export function tokensReady(): boolean {
  return tokensLoaded.value && tokensBroken.value === 0;
}

/** Минимум об агенте, нужный журналу отправок. */
export interface AgentExitContext {
  agent?: {
    id?: string;
    privacy?: PrivacyMode;
    tokenOnly?: boolean;
    address?: string;
  } | null;
  sessionId?: string | null;
}

const TOKEN_PATTERN = /⟦[^⟧]+⟧/g;

/** Текст для агента: значения заменяются токенами. Уже стоящие токены не ломаются. */
export function forAgent(text: string, context?: AgentExitContext): string {
  if (!text) return text;
  const outgoing = replaceValues(text).text;
  if (context?.agent?.id) void auditSend(outgoing, context);
  return outgoing;
}

/**
 * Контекст для модели: подстановка применяется и к старым сообщениям —
 * диалог мог начинаться до появления справочника или до защищённого режима.
 * Журнал здесь не пишется: это те же сообщения, а не новая отправка.
 */
export function historyForAgent<T extends { content: string }>(list: readonly T[]): T[] {
  return list.map((item) => ({ ...item, content: forAgent(item.content) }));
}

/** Запись в журнал не должна ломать отправку: любая ошибка гасится. */
async function auditSend(outgoing: string, context: AgentExitContext): Promise<void> {
  try {
    const agent = context.agent;
    await recordAudit({
      agentId: agent?.id ?? "",
      ...(context.sessionId ? { sessionId: context.sessionId } : {}),
      mode: resolvePrivacyMode(agent),
      provider: providerHost(agent?.address),
      trusted: isTrustedProvider(agent?.address, trustedProviders.value),
      tokens: (outgoing.match(TOKEN_PATTERN) ?? []).length,
      chars: outgoing.length,
    });
  } catch {
    // Журнал вспомогательный — из-за него сообщение не теряем.
  }
}
