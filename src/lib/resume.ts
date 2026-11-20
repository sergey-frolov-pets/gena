/**
 * Незавершённый ход: приложение закрыли, ответ не пришёл.
 *
 * Сервер Pico histórico не отдаёт (контекст живёт по `session_id`), поэтому
 * «догон» — это повторная отправка того же текста при следующем открытии
 * диалога. Чтобы не дублировать уже полученный ответ, перед повтором
 * проверяем историю: после реплики пользователя не должно быть ответа.
 */

import type { Message } from "@/storage/types";

export interface PendingTurn {
  /** Диалог, в котором ход не завершился. */
  sessionId: string;
  /** Текст отправленной реплики (без вложений — их в localStorage не кладём). */
  text: string;
  /** Когда отправляли (мс). */
  at: number;
}

/** Старше этого срока ход не догоняем — скорее всего, он уже неактуален. */
export const PENDING_TTL_MS = 45 * 60_000;

/** Ход ещё свежий и его имеет смысл повторять. */
export function isPendingFresh(pending: PendingTurn, now: number): boolean {
  if (!Number.isFinite(pending.at) || pending.at <= 0) return false;
  const age = now - pending.at;
  return age >= 0 && age < PENDING_TTL_MS;
}

function isFinalText(message: Message): boolean {
  return message.kind === undefined || message.kind === "text";
}

/**
 * Нужно ли догонять ход: реплика есть в истории, ответа после неё нет,
 * ход не старше TTL. Текст сравниваем с точностью до пробелов по краям.
 */
export function shouldResume(
  messages: readonly Message[],
  pending: PendingTurn,
  now: number,
): boolean {
  if (!isPendingFresh(pending, now)) return false;
  const text = pending.text.trim();
  if (!text) return false;

  let userIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === "user" && isFinalText(message) && message.content.trim() === text) {
      userIndex = i;
      break;
    }
  }
  if (userIndex < 0) return false;

  return !messages
    .slice(userIndex + 1)
    .some((message) => message.role === "assistant" && isFinalText(message));
}
