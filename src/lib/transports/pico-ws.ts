/**
 * Транспорт `pico_ws` — WebSocket-канал Pico.
 *
 * Auth — subprotocol `token.<token>`; `session_id` — query-параметр при коннекте
 * (история не шлётся: сервер хранит контекст по session_id).
 *
 * Как сервер отдаёт ход (см. pkg/channels/pico в PicoClaw):
 * 1. `typing.start`;
 * 2. `message.create` с `placeholder: true` — заглушка «думаю…», это НЕ ответ;
 * 3. `message.create` с `kind: thought|tool_calls` — шаги хода;
 * 4. `typing.stop` — приходит ДО финального ответа (preSend гасит индикатор);
 * 5. `message.create` без `kind` — финальный ответ, дальше `message.update`
 *    с тем же `message_id`, пока идёт стриминг.
 *
 * Поэтому конец хода — не `typing.stop`, а тишина после финального сообщения:
 * стрим обновляет один и тот же ответ и сдвигает «тихий» таймер.
 */

import { newId } from "@/lib/id";
import type { PicoConfig } from "@/storage/types";
import { parseIncomingAttachments } from "@/lib/media";
import { AgentClientError } from "./client-error";
import { PicoConnection, type PicoFrame, type PicoSocketCtor } from "./pico-connection";
import type {
  AgentTransport,
  TransportAttachment,
  TransportEvents,
  TransportRequest,
  TransportReply,
} from "./types";

/** Тишина после финального сообщения — считаем ход законченным. */
const QUIET_MS = 1_500;
/** Ни одного кадра столько времени — агент завис (долгие инструменты шлют шаги). */
const IDLE_TIMEOUT_MS = 15 * 60_000;
/** Абсолютный потолок одного хода, чтобы очередь не встала навсегда. */
const HARD_TIMEOUT_MS = 45 * 60_000;
const CONNECT_ATTEMPTS = 3;
const CONNECT_BACKOFF_MS = 1_000;

/** Один финальный ответ (сообщение или его стрим-обновление). */
interface FinalFrame {
  id: string;
  content: string;
  attachments?: TransportAttachment[];
}

export function buildWsUrl(address: string, sessionId: string): string {
  let url = address.trim();
  if (!url.includes("/pico/ws")) {
    url = url.replace(/\/+$/, "") + "/pico/ws";
  }
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}session_id=${encodeURIComponent(sessionId)}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Заглушка «думаю…» — не ответ, в историю она попадать не должна. */
function isPlaceholder(payload: Record<string, unknown>): boolean {
  return payload.placeholder === true;
}

export function makePicoTransport(ctor?: PicoSocketCtor): AgentTransport {
  const resolveCtor = (): PicoSocketCtor => {
    if (ctor) {
      return ctor;
    }
    const ws = (globalThis as { WebSocket?: PicoSocketCtor }).WebSocket;
    if (!ws) {
      throw new AgentClientError(
        "WebSocket is not available in this environment",
        undefined,
        "ws_connect",
      );
    }
    return ws;
  };

  return {
    async send(req: TransportRequest, ev: TransportEvents): Promise<TransportReply> {
      const agent = req.agent;
      if (!agent.address) {
        throw new AgentClientError("agent address is not set", undefined, "no_address");
      }

      const socketCtor = resolveCtor();
      const cfg = (agent.config ?? {}) as PicoConfig;
      const maxAttempts = cfg.reconnect === false ? 1 : CONNECT_ATTEMPTS;
      const url = buildWsUrl(agent.address, req.sessionId);
      const conn = new PicoConnection(socketCtor);
      const requestId = newId();

      return new Promise<TransportReply>((resolve, reject) => {
        /** Финальный ответ; `null` — ответа ещё не было (только заглушка/шаги). */
        let reply: FinalFrame | null = null;
        let settled = false;
        let quietTimer: ReturnType<typeof setTimeout> | null = null;
        let idleTimer: ReturnType<typeof setTimeout> | null = null;
        /** Шаги хода, уже отданные наверх — обновления по ним не дублируем. */
        const seenAux = new Set<string>();

        const hardTimer = setTimeout(() => {
          finish(
            reject,
            new AgentClientError("turn is too long, aborted by timeout", undefined, "ws_timeout"),
          );
        }, HARD_TIMEOUT_MS);

        function withAttachments(): TransportReply {
          return reply && reply.attachments && reply.attachments.length > 0
            ? { reply: reply.content, attachments: reply.attachments }
            : { reply: reply?.content ?? "" };
        }

        function clearTimers(): void {
          clearTimeout(hardTimer);
          if (quietTimer) {
            clearTimeout(quietTimer);
            quietTimer = null;
          }
          if (idleTimer) {
            clearTimeout(idleTimer);
            idleTimer = null;
          }
        }

        function finish<T>(fn: (value: T) => void, value: T): void {
          if (settled) {
            return;
          }
          settled = true;
          clearTimers();
          conn.close();
          fn(value);
        }

        /** Кадр пришёл — агент жив, сдвигаем watchdog. */
        function touch(): void {
          if (idleTimer) {
            clearTimeout(idleTimer);
          }
          idleTimer = setTimeout(() => {
            finish(
              reject,
              new AgentClientError("no events from agent", undefined, "ws_timeout"),
            );
          }, IDLE_TIMEOUT_MS);
        }

        /**
         * Конец хода — тишина после финального сообщения. Стрим-обновления
         * и шаги хода сдвигают таймер, поэтому длинный ответ не обрывается.
         */
        function armQuiet(): void {
          if (quietTimer) {
            clearTimeout(quietTimer);
          }
          quietTimer = setTimeout(() => {
            if (reply !== null) {
              finish(resolve, withAttachments());
            }
          }, QUIET_MS);
        }

        /** Финальное сообщение или его обновление: заменяем ответ, стримим прирост. */
        function setFinal(id: string, content: string, attachments?: TransportAttachment[]): void {
          const previous = reply && reply.id === id ? reply.content : "";
          const chunk = content.startsWith(previous) ? content.slice(previous.length) : content;
          if (chunk) {
            ev.onDelta?.(id, chunk);
          }
          reply = {
            id,
            content,
            ...(attachments && attachments.length > 0 ? { attachments } : {}),
          };
          armQuiet();
        }

        /** Шаг хода (мысль/вызовы инструментов): отдаём один раз, обновления — тихо. */
        function setAux(payload: Record<string, unknown>, kind: string): void {
          const id = str(payload.message_id);
          const content = str(payload.content);
          if (!id || !content) return;
          if (seenAux.has(id)) {
            ev.onUpdate?.(id, content);
            return;
          }
          seenAux.add(id);
          ev.onMessage?.({
            id,
            kind: kind as "thought" | "tool_calls",
            content,
            model: str(payload.model_name) || undefined,
            usage: payload.usage,
          });
        }

        const onAbort = () => {
          finish(reject, new AgentClientError("request aborted", undefined, "network", "aborted"));
        };
        if (req.signal) {
          req.signal.addEventListener("abort", onAbort);
        }

        conn.setHandlers({
          onMessage(frame: PicoFrame) {
            touch();
            const type = frame.type;
            const payload = (frame.payload ?? {}) as Record<string, unknown>;
            const kind = str(payload.kind);

            if (type === "typing.start") {
              ev.onTyping?.(true);
              return;
            }
            if (type === "typing.stop") {
              // Индикатор гаснет перед финальным ответом — ход это не завершает.
              ev.onTyping?.(false);
              return;
            }
            if (type === "error") {
              const request = str(payload.request_id);
              if (request && request !== requestId) {
                return;
              }
              const code = str(payload.code) || undefined;
              const msg = str(payload.message) || "agent error";
              finish(reject, new AgentClientError(msg, undefined, "pico_error", code));
              return;
            }
            if (type !== "message.create" && type !== "message.update") {
              return;
            }
            if (isPlaceholder(payload)) {
              return;
            }
            if (kind === "thought" || kind === "tool_calls") {
              setAux(payload, kind);
              return;
            }
            if (kind) {
              return;
            }
            const id = str(payload.message_id);
            // Обновление чужого финального сообщения игнорируем.
            if (reply && id && reply.id && id !== reply.id) {
              return;
            }
            setFinal(id, str(payload.content), parseIncomingAttachments(payload.attachments));
          },
          onClose() {
            if (settled) {
              return;
            }
            if (reply !== null) {
              finish(resolve, withAttachments());
              return;
            }
            finish(reject, new AgentClientError("connection closed", undefined, "ws_closed"));
          },
        });

        // Первый watchdog: агент должен подать хоть один кадр за IDLE_TIMEOUT_MS.
        touch();

        void (async () => {
          let lastErr: unknown = null;
          for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if (settled) {
              return;
            }
            try {
              await conn.connect(url, req.apiKey);
              conn.send({
                type: "message.send",
                id: requestId,
                timestamp: Date.now(),
                payload: {
                  content: req.message,
                  ...(req.media && req.media.length > 0 ? { media: req.media } : {}),
                },
              });
              return;
            } catch (err) {
              lastErr = err;
              if (attempt < maxAttempts - 1) {
                await delay(CONNECT_BACKOFF_MS * 2 ** attempt);
              }
            }
          }
          if (!settled) {
            const detail = lastErr instanceof Error ? lastErr.message : String(lastErr);
            finish(reject, new AgentClientError("could not connect", undefined, "ws_connect", detail));
          }
        })();
      });
    },
    dispose() {
      // Соединение открывается на каждый ход и закрывается по завершении.
    },
  };
}

export const picoTransport = makePicoTransport();
