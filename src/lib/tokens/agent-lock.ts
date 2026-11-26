/**
 * Защита на уровне подключения.
 *
 * У агента есть режим приватности (`privacy`):
 *   `tokens`  — диалоги всегда защищённые, снять защиту из чата нельзя;
 *   `trusted` — открытый текст только провайдеру из списка доверенных,
 *               иначе тихий откат к токенам;
 *   `auto`    — открытый текст, но с автоподсказками перед отправкой (M3).
 *
 * Агенты, созданные до M2, режима не имеют: если стоял «только защищённый режим» —
 * работаем как `tokens`, иначе поведение не меняем (совместимость), но в UI
 * такой агент помечен как «не настроен» и просит выбрать режим.
 */

import { isLegacyPrivacy, isTrustedProvider, resolvePrivacyMode } from "@/lib/privacy/mode";
import { trustedProviders } from "@/lib/privacy/trusted-providers";
import type { PrivacyMode } from "@/storage/types";

export interface PrivacyAwareAgent {
  privacy?: PrivacyMode;
  tokenOnly?: boolean;
  address?: string;
}

/** Агент требует защищённый режим во всех своих диалогах. */
export function agentRequiresTokens(
  agent?: PrivacyAwareAgent | null,
  trusted: readonly string[] = trustedProviders.value,
): boolean {
  if (!agent) return false;
  const mode = resolvePrivacyMode(agent);
  if (mode === "tokens") return true;
  // Старые записи жили открытым текстом — задним числом не ломаем.
  if (isLegacyPrivacy(agent)) return false;
  return !isTrustedProvider(agent.address, trusted);
}

/** Провайдер подключения входит в список доверенных. */
export function isAgentProviderTrusted(
  agent?: PrivacyAwareAgent | null,
  trusted: readonly string[] = trustedProviders.value,
): boolean {
  return isTrustedProvider(agent?.address, trusted);
}

/** Почему защищённый режим нельзя выключить в этом диалоге. */
export type TokenModeLock = "agent" | "links" | null;

/**
 * Замок снятия защиты: подключение агента сильнее локальных связей —
 * если режим стоит, объясняем именно его, а не пары «значение — токен».
 */
export function tokenModeLockReason(
  linkedNames: readonly string[],
  agentLocked: boolean,
): TokenModeLock {
  if (agentLocked) return "agent";
  if (linkedNames.length > 0) return "links";
  return null;
}
