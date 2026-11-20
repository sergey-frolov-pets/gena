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
  /**
   * Пассивное ожидание (`listen`): с какого момента (Unix-мс) просить у сервера
   * пропущенные кадры хода (`turn.resume`). Без него слушаем только живой поток.
   */
  resumeSince?: number;
}

/** Остановка идущего хода на стороне агента. */
export interface CancelRequest {
  agent: Agent;
  apiKey: string;
  sessionId: string;
}

/**
 * Итог отмены. `accepted: false` — активного хода нет (или сервер старый,
 * или соединение уже закрыто): локальный обрыв всё равно нужен, но сервер
 * генерацию не прекратит.
 */
export interface CancelResult {
  accepted: boolean;
  reason?: string;
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
  /** Идентификатор финального сообщения на стороне агента (для `message.delete`). */
  serverId?: string;
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
  /**
   * Агент удалил сообщение (`message.delete`): правка на стороне Pico.
   * `id` — идентификатор сообщения агента, а не локальный.
   */
  onDelete?: (id: string) => void;
  /**
   * Ответ на `turn.resume`: сколько кадров сервер отдал и идёт ли ход.
   * `active: false` и ноль кадров — ответа не будет, реплику надо повторить.
   */
  onTurnState?: (state: { active: boolean; frames: number }) => void;
  /**
   * Состояние связи по ходу дела.
   *
   * `reconnecting` — соединение пропало (частая история в фоне: телефон уснул,
   * вкладку свернули) и транспорт молча переподключается; `restored` — связь
   * вернулась и пропущенные кадры хода добраны. Это не ошибка, поэтому UI
   * показывает такие состояния строкой статуса, а не красной плашкой.
   */
  onLinkState?: (state: "reconnecting" | "restored") => void;
}

export interface AgentTransport {
  send(req: TransportRequest, ev: TransportEvents): Promise<TransportReply>;
  /**
   * Подключиться к сессии и дождаться ответа уже идущего хода, ничего не отправляя.
   * Нужен, чтобы после закрытия приложения подобрать ответ, а не дублировать реплику.
   * Есть только у транспортов с постоянным соединением (`pico_ws`).
   */
  listen?(req: TransportRequest, ev: TransportEvents): Promise<TransportReply>;
  /**
   * Попросить сервер остановить идущий ход (`cancel`). Локальный обрыв нужен
   * всё равно: кадр только прекращает генерацию на сервере.
   */
  cancel?(req: CancelRequest): Promise<CancelResult>;
  /** Освободить ресурсы (закрыть WebSocket и т.п.). */
  dispose?(): void;
}
