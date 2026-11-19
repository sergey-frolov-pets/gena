/**
 * Фасад отправки сообщения агенту.
 *
 * Выбирает транспорт по `agent.protocol` (см. transports/index.ts) и
 * возвращает итоговый ответ. Промежуточные события (мысли, tool_calls,
 * индикатор набора) уходят через `events`.
 */

import type { Agent, AgentSettings, Message } from "@/storage/types";
import { getTransport, type TransportEvents } from "./transports";
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
}

export { AgentClientError, type AgentClientErrorCode } from "./transports";
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
