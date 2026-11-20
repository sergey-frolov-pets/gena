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
 *
 * Две тонкости, из-за которых раньше «писало про таймаут, а размышления шли»:
 * - при сбое модели сервер публикует служебную плашку («⏳ Модель не ответила
 *   вовремя…») обычным сообщением без `kind`, но ход продолжается на резервной
 *   модели. Такую плашку отдаём в `onNotice`, а не считаем ответом;
 * - `error`-кадр может прийти посреди живого хода — даём ему паузу и гасим,
 *   если после него пришли новые кадры.
 *
 * `listen()` — подключение к сессии без отправки: сервер вещает кадры всем
 * соединениям сессии, поэтому после закрытия приложения ответ можно подобрать.
 */

import { newId } from "@/lib/id";
import type { PicoConfig } from "@/storage/types";
import { parseIncomingAttachments } from "@/lib/media";
import { isTurnNotice } from "@/lib/notices";
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
/** Пауза после `error`-кадра: ход может продолжиться на резервной модели. */
const ERROR_GRACE_MS = 3_000;
/** После служебной плашки ждём настоящий ответ; тишина дольше — ход умер. */
const NOTICE_IDLE_MS = 120_000;
/** Ни одного кадра столько времени — агент завис (долгие инструменты шлют шаги). */
const IDLE_TIMEOUT_MS = 15 * 60_000;
/** Абсолютный потолок одного хода, чтобы очередь не встала навсегда. */
const HARD_TIMEOUT_MS = 45 * 60_000;
const CONNECT_ATTEMPTS = 3;
const CONNECT_BACKOFF_MS = 1_000;
/** Сколько ждём открытия WebSocket, прежде чем повторить подключение. */
const CONNECT_TIMEOUT_MS = 15_000;

function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

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

/** WebSocket берём из окружения; в тестах подставляется фабрикой. */
function resolveSocketCtor(ctor?: PicoSocketCtor): PicoSocketCtor {
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
}

/**
 * Один ход или пассивное ожидание хода на своём соединении.
 * `shouldSend=false` — ничего не отправляем, только слушаем сессию.
 */
function runTurn(
  req: TransportRequest,
  ev: TransportEvents,
  shouldSend: boolean,
  ctor?: PicoSocketCtor,
): Promise<TransportReply> {
  const agent = req.agent;
  if (!agent.address) {
    return Promise.reject(
      new AgentClientError("agent address is not set", undefined, "no_address"),
    );
  }

  const cfg = (agent.config ?? {}) as PicoConfig;
  const maxAttempts = cfg.reconnect === false ? 1 : CONNECT_ATTEMPTS;
  const url = buildWsUrl(agent.address, req.sessionId);
  const conn = new PicoConnection(resolveSocketCtor(ctor));
  const requestId = newId();

  return new Promise<TransportReply>((resolve, reject) => {
    /** Финальный ответ; `null` — ответа ещё не было (только заглушка/шаги). */
    let reply: FinalFrame | null = null;
    let settled = false;
    let quietTimer: ReturnType<typeof setTimeout> | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let errorTimer: ReturnType<typeof setTimeout> | null = null;
    let noticeTimer: ReturnType<typeof setTimeout> | null = null;
    /** `error`-кадр, которому ещё даём шанс оказаться шумом. */
    let pendingError: AgentClientError | null = null;
    /** Соединение реально открылось — до этого close не считается концом хода. */
    let opened = false;
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
      if (errorTimer) {
        clearTimeout(errorTimer);
        errorTimer = null;
      }
      if (noticeTimer) {
        clearTimeout(noticeTimer);
        noticeTimer = null;
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

    /** Снять отложенный `error`-кадр: следующий кадр доказал, что ход жив. */
    function clearPendingError(): void {
      if (errorTimer) {
        clearTimeout(errorTimer);
        errorTimer = null;
      }
      pendingError = null;
    }

    /** Кадр пришёл — агент жив, сдвигаем watchdog и снимаем «шумовые» таймеры. */
    function touch(): void {
      clearPendingError();
      if (noticeTimer) {
        clearTimeout(noticeTimer);
        noticeTimer = null;
      }
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

    /**
     * Служебная плашка сервера: показываем строкой статуса, ответом не считаем.
     * Если после неё ничего не придёт — ход действительно умер.
     */
    function showNotice(text: string): void {
      ev.onNotice?.(text);
      if (noticeTimer) {
        clearTimeout(noticeTimer);
      }
      noticeTimer = setTimeout(() => {
        if (!settled && reply === null) {
          finish(
            reject,
            new AgentClientError("turn ended with a notice", undefined, "ws_timeout"),
          );
        }
      }, NOTICE_IDLE_MS);
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
          // Пассивное соединение чужие ошибки не разбирает; после ответа — шум.
          if (!shouldSend || reply !== null) {
            return;
          }
          const code = str(payload.code) || undefined;
          const msg = str(payload.message) || "agent error";
          // Не рубим ход сразу: посреди живой генерации такие кадры бывают шумом.
          pendingError = new AgentClientError(msg, undefined, "pico_error", code);
          if (errorTimer) {
            clearTimeout(errorTimer);
          }
          errorTimer = setTimeout(() => {
            if (!settled && pendingError) {
              finish(reject, pendingError);
            }
          }, ERROR_GRACE_MS);
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
        const content = str(payload.content);
        // Плашка об ошибке — не ответ: ход продолжается, ответ придёт следом.
        if (reply === null && isTurnNotice(content)) {
          showNotice(content);
          return;
        }
        setFinal(id, content, parseIncomingAttachments(payload.attachments));
      },
      onClose() {
        if (settled || !opened) {
          return;
        }
        if (pendingError) {
          finish(reject, pendingError);
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
          await withTimeout(
            conn.connect(url, req.apiKey),
            CONNECT_TIMEOUT_MS,
            "WebSocket connect timeout",
          );
          opened = true;
          if (!shouldSend) {
            // Пассивное ожидание: ничего не отправляем, слушаем сессию.
            return;
          }
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
          conn.close();
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
}

export function makePicoTransport(ctor?: PicoSocketCtor): AgentTransport {
  return {
    send(req: TransportRequest, ev: TransportEvents): Promise<TransportReply> {
      return runTurn(req, ev, true, ctor);
    },
    listen(req: TransportRequest, ev: TransportEvents): Promise<TransportReply> {
      return runTurn(req, ev, false, ctor);
    },
    dispose() {
      // Соединение открывается на каждый ход и закрывается по завершении.
    },
  };
}

export const picoTransport = makePicoTransport();
