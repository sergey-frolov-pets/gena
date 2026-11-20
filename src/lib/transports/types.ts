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
  /** data-URL изображений (поддерживает только `pico_ws`). */
  media?: string[];
  history: Message[];
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
}

/** Вложение, пришедшее от агента (Pico: только изображения, путь на сервере). */
export interface TransportAttachment {
  url: string;
  filename?: string;
  contentType?: string;
}

/** Итог хода: текст ответа и вложения финального сообщения. */
export interface TransportReply {
  reply: string;
  attachments?: TransportAttachment[];
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
  /**
   * Служебная плашка сервера («модель не ответила вовремя» и т.п.).
   * Ход при этом продолжается — плашку показываем строкой статуса, а не ответом.
   */
  onNotice?: (text: string) => void;
}

export interface AgentTransport {
  send(req: TransportRequest, ev: TransportEvents): Promise<TransportReply>;
  /**
   * Подключиться к сессии и дождаться ответа уже идущего хода, ничего не отправляя.
   * Нужен, чтобы после закрытия приложения подобрать ответ, а не дублировать реплику.
   * Есть только у транспортов с постоянным соединением (`pico_ws`).
   */
  listen?(req: TransportRequest, ev: TransportEvents): Promise<TransportReply>;
  /** Освободить ресурсы (закрыть WebSocket и т.п.). */
  dispose?(): void;
}
