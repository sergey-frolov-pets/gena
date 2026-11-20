/**
 * Фасад отправки сообщения агенту.
 *
 * Выбирает транспорт по `agent.protocol` (см. transports/index.ts) и
 * возвращает итоговый ответ. Промежуточные события (мысли, tool_calls,
 * индикатор набора) уходят через `events`.
 */

import type { Agent, AgentSettings, Message } from "@/storage/types";
import { getTransport, type TransportEvents } from "./transports";
import type { TransportAttachment } from "./transports/types";
import { trimHistory } from "./transports/history";

export interface AgentRequest {
  message: string;
  /** data-URL изображений; сервер Pico принимает только изображения. */
  media?: string[];
  sessionId: string;
  settings: AgentSettings;
  /** Последние сообщения как контекст (обрезается по settings.contextSize). */
  history: Message[];
}

export interface AgentResponse {
  reply: string;
  /** Вложения финального сообщения (Pico: изображения по пути `/pico/media/...`). */
  attachments?: TransportAttachment[];
  /** Идентификатор сообщения на стороне агента (Pico). */
  serverId?: string;
}

export { AgentClientError, type AgentClientErrorCode } from "./transports";
export type { TransportAttachment } from "./transports/types";
export { trimHistory };

export interface SendOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  events?: TransportEvents;
}

export async function sendToAgent(
  agent: Agent,
  apiKey: string,
  request: AgentRequest,
  options?: SendOptions | typeof fetch,
): Promise<AgentResponse> {
  const opts: SendOptions =
    typeof options === "function" ? { fetchImpl: options } : (options ?? {});
  const transport = getTransport(agent);
  return transport.send(
    {
      agent,
      apiKey,
      sessionId: request.sessionId,
      message: request.message,
      media: request.media,
      history: request.history,
      signal: opts.signal ?? new AbortController().signal,
      fetchImpl: opts.fetchImpl ?? fetch,
    },
    opts.events ?? {},
  );
}

export interface ListenRequest {
  sessionId: string;
  history?: Message[];
  signal: AbortSignal;
  events?: TransportEvents;
}

/**
 * Подключиться к сессии и дождаться ответа уже идущего хода, ничего не отправляя.
 *
 * Нужно после закрытия приложения: сервер Pico вещает кадры всем соединениям
 * сессии, поэтому ответ можно подобрать, а не дублировать реплику.
 * Есть только у транспортов с постоянным соединением — иначе бросает.
 */
export async function listenToAgent(
  agent: Agent,
  apiKey: string,
  request: ListenRequest,
): Promise<AgentResponse> {
  const transport = getTransport(agent);
  if (!transport.listen) {
    throw new Error(`transport ${agent.protocol ?? "http_json"} does not support listening`);
  }
  return transport.listen(
    {
      agent,
      apiKey,
      sessionId: request.sessionId,
      message: "",
      history: request.history ?? [],
      signal: request.signal,
      fetchImpl: fetch,
    },
    request.events ?? {},
  );
}
