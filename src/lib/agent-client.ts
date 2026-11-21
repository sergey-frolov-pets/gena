/**
 * Фасад отправки сообщения агенту.
 *
 * Выбирает транспорт по `agent.protocol` (см. transports/index.ts) и
 * возвращает итоговый ответ. Промежуточные события (мысли, tool_calls,
 * индикатор набора) уходят через `events`.
 */

import type { Agent, AgentSettings, Message } from "@/storage/types";
import { sendModelFallback } from "./model-fallback";
import { getTransport, type TransportEvents } from "./transports";
import type { TransportAttachment } from "./transports/types";
import type { CancelResult } from "./transports/types";
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
  /** Модель, которая ответила (пул и сводка). */
  model?: string;
  /** Вложения финального сообщения (Pico: изображения по пути `/pico/media/...`). */
  attachments?: TransportAttachment[];
  /** Идентификатор сообщения на стороне агента (Pico). */
  serverId?: string;
  /** Расход токенов, если сервер его сообщил. */
  usage?: unknown;
}

export { AgentClientError, type AgentClientErrorCode } from "./transports";
export type { TransportAttachment } from "./transports/types";
export { trimHistory };

export interface SendOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  events?: TransportEvents;
  /** Другие агенты — источники моделей для сводки. */
  peers?: Agent[];
  openKey?: (provider: Agent) => Promise<string>;
}

export async function sendToAgent(
  agent: Agent,
  apiKey: string,
  request: AgentRequest,
  options?: SendOptions | typeof fetch,
): Promise<AgentResponse> {
  const opts: SendOptions =
    typeof options === "function" ? { fetchImpl: options } : (options ?? {});
  if (agent.protocol === "model_pool" || agent.protocol === "model_mix") {
    return sendModelFallback(agent, apiKey, opts.peers ?? [], request, {
      fetchImpl: opts.fetchImpl,
      signal: opts.signal,
      events: opts.events,
      openKey: opts.openKey ?? (async () => ""),
    });
  }
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
  /** С какого момента (Unix-мс) просить пропущенные кадры хода (`turn.resume`). */
  since?: number;
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
      resumeSince: request.since,
      fetchImpl: fetch,
    },
    request.events ?? {},
  );
}

/**
 * Попросить агента остановить идущий ход.
 *
 * Для `pico_ws` это кадр `cancel`: без него закрытие сокета не останавливает
 * генерацию — модель продолжает считаться и тратить токены.
 * Транспорты без поддержки возвращают `accepted: false`.
 */
export async function cancelAgentTurn(
  agent: Agent,
  apiKey: string,
  sessionId: string,
): Promise<CancelResult> {
  const transport = getTransport(agent);
  if (!transport.cancel) {
    return { accepted: false, reason: "unsupported" };
  }
  return transport.cancel({ agent, apiKey, sessionId });
}
