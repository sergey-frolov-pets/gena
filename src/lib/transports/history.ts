/**
 * Обрезка истории и фильтрация сообщений для контекста модели.
 *
 * В контекст модели попадают только обычные текстовые сообщения
 * (без `kind` либо `kind: "text"`). Мысли (`thought`) и вызовы инструментов
 * (`tool_calls`) в историю для модели не идут.
 */

import type { Message } from "@/storage/types";

/** Обрезать историю до `contextSize` последних сообщений. */
export function trimHistory(history: Message[], contextSize: number): Message[] {
  if (contextSize <= 0) {
    return [];
  }
  return history.slice(-contextSize);
}

/** Сообщения, пригодные для передачи модели как контекст. */
export function contextMessages(history: Message[]): Message[] {
  return history.filter((m) => m.kind === undefined || m.kind === "text");
}

/** Привести сообщение к компактной форме для HTTP-тела запроса. */
export function toWireMessage(m: Message): { role: string; content: string } {
  return { role: m.role, content: m.content };
}
