/**
 * Общий контракт транспортов агента.
 *
 * Транспорт — реализация одного протокола (`http_json`, `openai`, `pico_ws`).
 * Фасад `agent-client.ts` выбирает транспорт по `agent.protocol`.
 */

import type { Agent, Message } from "@/storage/types";

/** Запрос к агенту. `fetchImpl` нужен только для тестов (по умолчанию глобальный fetch). */
export interface TransportRequest {
  agent: Agent;
  apiKey: string;
  sessionId: string;
  message: string;
  history: Message[];
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
}

/** Событие промежуточного сообщения (мысль / вызовы инструментов / стрим). */
export interface TransportMessage {
  id: string;
  kind?: "text" | "thought" | "tool_calls";
  content: string;
  model?: string;
  usage?: unknown;
}

/** Колбэки, которые транспорт дёргает по ходу хода. */
export interface TransportEvents {
  onTyping?: (on: boolean) => void;
  onMessage?: (m: TransportMessage) => void;
  onDelta?: (id: string, chunk: string) => void;
  onUpdate?: (id: string, content: string) => void;
}

export interface AgentTransport {
  send(req: TransportRequest, ev: TransportEvents): Promise<{ reply: string }>;
  /** Освободить ресурсы (закрыть WebSocket и т.п.). */
  dispose?(): void;
}
