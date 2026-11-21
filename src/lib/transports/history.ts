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

export type WireMessage = { role: string; content: string };

/**
 * Kimi (Moonshot) отвечает 400, если роли не чередуются, контент пустой
 * или `system` стоит не первым. Склеиваем соседние реплики одной роли,
 * пустые выбрасываем, ведущие `assistant` отбрасываем.
 */
export function coalesceStrictTurns(messages: WireMessage[]): WireMessage[] {
  const systems: string[] = [];
  const turns: WireMessage[] = [];
  for (const message of messages) {
    const content = message.content.trim();
    if (!content) continue;
    if (message.role === "system") {
      systems.push(content);
      continue;
    }
    const role = message.role === "assistant" ? "assistant" : "user";
    const prev = turns[turns.length - 1];
    if (prev && prev.role === role) {
      prev.content = `${prev.content}\n\n${content}`;
    } else {
      turns.push({ role, content });
    }
  }
  while (turns.length > 0 && turns[0]?.role === "assistant") {
    turns.shift();
  }
  if (systems.length === 0) return turns;
  return [{ role: "system", content: systems.join("\n\n") }, ...turns];
}

/** Kimi / Moonshot требуют строгое чередование ролей. */
export function providerRequiresStrictTurns(address: string): boolean {
  try {
    const host = new URL(address).hostname.toLowerCase();
    return host === "moonshot.ai" || host.endsWith(".moonshot.ai") || host.endsWith(".moonshot.cn");
  } catch {
    return false;
  }
}
