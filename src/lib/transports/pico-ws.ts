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
import { PICO_CAPABILITIES } from "./capabilities";
import { AgentClientError } from "./client-error";
import { idleTurn, stepTurn, type TurnState } from "@/turn/machine";
import { PicoConnection, WS_OPEN, type PicoFrame, type PicoSocketCtor } from "./pico-connection";
import type {
  AgentTransport,
  CancelRequest,
  CancelResult,
  TransportAttachment,
  TransportEvents,
  TransportRequest,
  TransportReply,
} from "./types";

/** Тишина после финального сообщения — считаем ход законченным. */
const QUIET_MS = 1_500;
/** Пауза после `error`-кадра: ход может продолжиться на резервной модели. */
const ERROR_GRACE_MS = 3_000;
/**
 * После служебной плашки ждём настоящий ответ.
 *
 * Плашка значит «модель не ответила вовремя, переключаюсь на резервную» —
 * резервная думает долго и может молчать несколько минут, поэтому тишина
 * считается обрывом только через 10 минут (раньше было 2 — отсюда ложные
 * `ws_timeout`, когда задача на самом деле продолжалась).
 */
const NOTICE_IDLE_MS = 10 * 60_000;
/** Ни одного кадра столько времени — агент завис (долгие инструменты шлют шаги). */
const IDLE_TIMEOUT_MS = 15 * 60_000;
/** Абсолютный потолок одного хода, чтобы очередь не встала навсегда. */
const HARD_TIMEOUT_MS = 45 * 60_000;
const CONNECT_ATTEMPTS = 3;
const CONNECT_BACKOFF_MS = 1_000;
/** Сколько ждём открытия WebSocket, прежде чем повторить подключение. */
const CONNECT_TIMEOUT_MS = 15_000;
/**
 * Прикладной ping: раз в 25 с спрашиваем сервер «ты жив?».
 *
 * Нужен, чтобы мёртвое соединение (например, телефон ушёл в спящую сеть)
 * обнаруживалось за ~минуту, а не за 15 минут тишины. Сервер отвечает `pong`
 * тем же `id` (см. `pkg/channels/pico` в PicoClaw).
 */
const PING_INTERVAL_MS = 25_000;
/** Столько тишины при отправленных ping считаем обрывом (три пропущенных pong). */
const PING_SILENCE_MS = 75_000;
/** Подтверждение `cancel` ждём недолго: локальный обрыв нужен всё равно. */
const CANCEL_ACK_MS = 2_500;
/**
 * Паузы перед попытками молчаливого переподключения.
 *
 * Потеря WebSocket посреди хода — почти всегда не ошибка, а фон: мобильный
 * браузер закрывает сокет при сворачивании вкладки и блокировке экрана.
 * Сервер копит кадры хода (200 кадров / 2 МБ, 6 ч), поэтому после
 * переподключения пропущенное добирается кадром `turn.resume`.
 */
const RECOVER_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000, 15_000];
/** Сколько раз за один ход восстанавливаем связь (защита от «мигания»). */
const MAX_RECOVERIES = 6;
/** В фоне ждём возвращения на вкладку, прежде чем пробовать снова. */
const HIDDEN_WAIT_MS = 20_000;
/** Отступ назад при запросе пропущенных кадров: расхождение часов клиента и сервера. */
const RESUME_MARGIN_MS = 60_000;
/**
 * Переспрос «ход ещё идёт?» после переподключения.
 *
 * Сокет может умереть сразу после отправки реплики — сервер в этот момент ещё
 * не начал ход, и `turn.resume` честно отвечает `active: false`. Два переспроса
 * с паузой позволяют отличить «ход не начался» от «реплика потеряна».
 */
const RESUME_PROBE_MS = 6_000;
const RESUME_PROBES = 2;

/**
 * Активные ходы текущей вкладки. По ним кнопка «Стоп» просит сервер
 * прекратить генерацию (`cancel`), иначе после закрытия сокета модель
 * продолжает считаться и жечь токены.
 */
interface ActiveTurn {
  key: string;
  cancel: () => Promise<CancelResult>;
}

const activeTurns = new Set<ActiveTurn>();

/** Адрес агента в одном виде: без хвостовых слэшей и регистра. */
function normaliseAddress(address: string): string {
  return address.trim().replace(/\/+$/, "").toLowerCase();
}

function turnKey(address: string, sessionId: string): string {
  return `${normaliseAddress(address)}|${sessionId}`;
}

/**
 * Попросить сервер остановить идущий ход в этой вкладке.
 * Нет активного соединения — отменять нечего (или ход уже кончился).
 */
export async function cancelPicoTurn(address: string, sessionId: string): Promise<CancelResult> {
  const key = turnKey(address, sessionId);
  const turn = [...activeTurns].find((item) => item.key === key);
  if (!turn) {
    return { accepted: false, reason: "no_active_turn" };
  }
  return turn.cancel();
}

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

/** Вкладка скрыта: телефон может спать, сеть приостановлена — ошибкой это не считаем. */
function pageHidden(): boolean {
  try {
    return typeof document !== "undefined" && document.visibilityState === "hidden";
  } catch {
    return false;
  }
}

/**
 * Дождаться возвращения на вкладку (или просто выждать паузу, если браузера нет).
 * Пока приложение в фоне, попытки переподключения бессмысленны: сеть выключена.
 */
function whenVisible(ms: number): Promise<void> {
  if (!pageHidden()) {
    return delay(ms);
  }
  return new Promise<void>((resolve) => {
    let done = false;
    const finishWait = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        document.removeEventListener("visibilitychange", onVisible);
      } catch {
        // Документа нет — обработчик и не добавлялся.
      }
      resolve();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") finishWait();
    };
    const timer = setTimeout(finishWait, ms);
    try {
      document.addEventListener("visibilitychange", onVisible);
    } catch {
      finishWait();
    }
  });
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
    /** Переспрос `turn.resume` после переподключения. */
    let resumeProbeTimer: ReturnType<typeof setTimeout> | null = null;
    /** Прикладной ping: связь проверяется, даже когда агент долго молчит. */
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    /** Когда последний раз приходил ЛЮБОЙ кадр (включая `pong`). */
    let lastFrameAt = Date.now();
    /** `error`-кадр, которому ещё даём шанс оказаться шумом. */
    let pendingError: AgentClientError | null = null;
    /** Соединение реально открылось — до этого close не считается концом хода. */
    let opened = false;
    /** Соединение открыто прямо сейчас (а не «открывалось когда-то»). */
    let linkUp = false;
    /** Когда отправили реплику: с этого момента просим у сервера пропущенные кадры. */
    let sentAt = 0;
    /** Идущее молчаливое переподключение (одно на ход). */
    let recovering: Promise<boolean> | null = null;
    /** Сколько раз уже восстанавливали связь — потолок решает автомат хода. */
    let turn: TurnState = stepTurn(
      stepTurn(idleTurn(MAX_RECOVERIES), {
        type: "enqueue",
        clientTurnId: requestId,
        text: req.message,
      }),
      { type: "start" },
    );
    /** Сколько раз переспросили сервер «ход идёт?» после пустого `turn.resume`. */
    let resumeProbes = 0;
    /** Потолок хода: в фоне сдвигается, а не рубит работу. */
    let hardTimer: ReturnType<typeof setTimeout> | null = null;
    /** Шаги хода, уже отданные наверх — обновления по ним не дублируем. */
    const seenAux = new Set<string>();
    /** Ожидающее подтверждение `cancel` (кнопка «Стоп»). */
    let cancelId: string | null = null;
    let cancelWaiter: ((result: CancelResult) => void) | null = null;
    let cancelPromise: Promise<CancelResult> | null = null;
    /** Соединение зарегистрировано как «ход можно отменить». */
    let registered: ActiveTurn | null = null;

    function unregister(): void {
      if (registered) {
        activeTurns.delete(registered);
        registered = null;
      }
    }

    /** Отправить `cancel` серверу и подождать ответ (не дольше CANCEL_ACK_MS). */
    function requestCancel(): Promise<CancelResult> {
      if (cancelPromise) {
        return cancelPromise;
      }
      if (settled || !opened || conn.readyState !== WS_OPEN) {
        return Promise.resolve({ accepted: false, reason: "no_active_turn" });
      }
      const id = newId();
      cancelId = id;
      cancelPromise = new Promise<CancelResult>((resolve) => {
        const done = (result: CancelResult) => {
          if (!cancelWaiter) {
            return;
          }
          cancelWaiter = null;
          cancelId = null;
          clearTimeout(timer);
          resolve(result);
        };
        const timer = setTimeout(() => done({ accepted: false, reason: "timeout" }), CANCEL_ACK_MS);
        cancelWaiter = done;
      });
      try {
        conn.send({ type: "cancel", id, timestamp: Date.now(), payload: {} });
      } catch {
        cancelWaiter?.({ accepted: false, reason: "send_failed" });
      }
      return cancelPromise;
    }

    /**
     * Потолок хода. В фоне не срабатывает: таймеры придерживаются, а работа
     * агента на сервере идёт — поэтому проваливаемся дальше по кругу.
     */
    function armHard(): void {
      hardTimer = setTimeout(function hardCheck() {
        if (settled) return;
        if (pageHidden()) {
          armHard();
          return;
        }
        finish(
          reject,
          new AgentClientError("turn is too long, aborted by timeout", undefined, "ws_timeout"),
        );
      }, HARD_TIMEOUT_MS);
    }
    armHard();

    function withAttachments(): TransportReply {
      const base: TransportReply = { reply: reply?.content ?? "" };
      if (reply?.attachments && reply.attachments.length > 0) {
        base.attachments = reply.attachments;
      }
      if (reply?.id) {
        base.serverId = reply.id;
      }
      return base;
    }

    function clearTimers(): void {
      if (hardTimer) {
        clearTimeout(hardTimer);
        hardTimer = null;
      }
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
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
      if (resumeProbeTimer) {
        clearTimeout(resumeProbeTimer);
        resumeProbeTimer = null;
      }
    }

    function finish<T>(fn: (value: T) => void, value: T): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimers();
      unregister();
      cancelWaiter?.({ accepted: false, reason: "turn_finished" });
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

    /**
     * Watchdog молчания. В фоне не срабатывает: вкладка спит, а ход на сервере
     * идёт, поэтому таймер продлевается до возвращения.
     */
    function armIdle(): void {
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      idleTimer = setTimeout(function idleCheck() {
        if (settled) return;
        if (pageHidden()) {
          armIdle();
          return;
        }
        finish(reject, new AgentClientError("no events from agent", undefined, "ws_timeout"));
      }, IDLE_TIMEOUT_MS);
    }

    /** Кадр пришёл — агент жив, сдвигаем watchdog и снимаем «шумовые» таймеры. */
    function touch(): void {
      lastFrameAt = Date.now();
      // Настоящий кадр от агента: связь работает — бюджет восстановлений свежий.
      turn = { ...turn, attempt: 0 };
      clearPendingError();
      if (noticeTimer) {
        clearTimeout(noticeTimer);
        noticeTimer = null;
      }
      armIdle();
    }

    /**
     * Прикладной ping: сервер отвечает `pong` с тем же `id`, поэтому тишина
     * дольше трёх интервалов — это мёртвое соединение, а не долгая работа.
     */
    function startPings(): void {
      if (pingTimer) {
        return;
      }
      pingTimer = setInterval(() => {
        if (settled) return;
        if (pageHidden()) {
          // В фоне таймеры придерживаются, а сеть у телефона может быть выключена:
          // тишина здесь ничего не доказывает, проверяем связь после возвращения.
          lastFrameAt = Date.now();
          return;
        }
        if (conn.readyState !== WS_OPEN) {
          return;
        }
        if (Date.now() - lastFrameAt >= PING_SILENCE_MS) {
          finish(
            reject,
            new AgentClientError("connection lost: no pong", undefined, "ws_timeout", "no_pong"),
          );
          return;
        }
        conn.send({ type: "ping", id: newId(), timestamp: Date.now() });
      }, PING_INTERVAL_MS);
    }

    /**
     * Молчаливое восстановление связи.
     *
     * Потеря WebSocket посреди хода — обычно не ошибка, а фон (вкладку свернули,
     * телефон уснул). Переподключаемся и просим у сервера кадры с момента
     * отправки реплики: сервер вещает их всем соединениям сессии и копит в буфере.
     * Только если восстановиться так и не удалось, ход падает ошибкой `ws_closed`.
     *
     * Пока вкладка спрятана, попытки не расходуются: сеть у телефона в фоне
     * выключена, и раньше шесть «неудач» там заканчивались красной ошибкой,
     * хотя ход на сервере шёл и ответ лежал в буфере.
     */
    function recover(): Promise<boolean> {
      if (recovering) {
        return recovering;
      }
      turn = stepTurn(turn, { type: "socketClosed" });
      if (turn.phase === "failed") {
        return Promise.resolve(false);
      }
      ev.onLinkState?.("reconnecting");
      recovering = (async () => {
        try {
          let attempt = 0;
          while (!settled) {
            if (pageHidden()) {
              await whenVisible(HIDDEN_WAIT_MS);
              continue;
            }
            if (attempt >= RECOVER_DELAYS_MS.length) {
              return false;
            }
            await delay(RECOVER_DELAYS_MS[attempt]);
            attempt += 1;
            if (settled) return true;
            try {
              await withTimeout(
                conn.connect(url, req.apiKey),
                CONNECT_TIMEOUT_MS,
                "WebSocket connect timeout",
              );
            } catch {
              conn.close();
              continue;
            }
            linkUp = true;
            opened = true;
            lastFrameAt = Date.now();
            startPings();
            const from = (shouldSend ? sentAt : req.resumeSince ?? sentAt) || Date.now();
            conn.send({
              type: "turn.resume",
              id: newId(),
              timestamp: Date.now(),
              payload: { since: Math.max(0, from - RESUME_MARGIN_MS), limit: 200 },
            });
            armIdle();
            turn = stepTurn(turn, { type: "resume" });
            ev.onLinkState?.("restored");
            return true;
          }
          return false;
        } finally {
          recovering = null;
        }
      })();
      return recovering;
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
      noticeTimer = setTimeout(function noticeCheck() {
        if (settled) return;
        if (pageHidden()) {
          // Плашка пришла перед уходом в фон — там ждать ответа некому.
          noticeTimer = setTimeout(noticeCheck, NOTICE_IDLE_MS);
          return;
        }
        if (reply === null) {
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

    /** Один кадр сервера: разбор типа и отдача наверх. */
    function handleFrame(frame: PicoFrame): void {
        // `pong` подтверждает живость соединения, но ход им не продлеваем:
        // иначе watchdog молчания никогда бы не сработал.
        if (frame.type === "pong") {
          lastFrameAt = Date.now();
          return;
        }
        // Подтверждение отмены: относится к нашей заявке, ход им не продлеваем.
        if (frame.type === "cancel") {
          const ack = (frame.payload ?? {}) as Record<string, unknown>;
          const request = str(ack.request_id) || str(frame.id);
          if (!cancelId || request !== cancelId) {
            return;
          }
          const waiter = cancelWaiter;
          waiter?.({ accepted: ack.accepted === true, reason: str(ack.reason) || undefined });
          return;
        }
        // Ответ на запрос пропущенных кадров: применяем их как обычные кадры.
        if (frame.type === "turn.resume" || frame.type === "message.history") {
          const bundle = (frame.payload ?? {}) as Record<string, unknown>;
          const frames = Array.isArray(bundle.frames) ? (bundle.frames as PicoFrame[]) : [];
          for (const item of frames) {
            if (item && typeof item === "object") {
              handleFrame(item);
            }
          }
          const active = bundle.active === true;
          ev.onTurnState?.({ active, frames: frames.length });
          if (active || reply !== null) {
            return;
          }
          // Пассивное ожидание: хода на сервере нет — ответа уже не будет,
          // наверх уходит `no_active_turn`, и реплика повторяется.
          if (!shouldSend) {
            finish(
              reject,
              new AgentClientError("turn is not running", undefined, "no_active_turn"),
            );
            return;
          }
          // Сокет мог умереть сразу после отправки — сервер ещё не успел начать
          // ход. Спрашиваем ещё пару раз, прежде чем считать реплику потерянной:
          // иначе повторная отправка создавала дубль хода.
          if (resumeProbes < RESUME_PROBES) {
            resumeProbes += 1;
            if (resumeProbeTimer) {
              clearTimeout(resumeProbeTimer);
            }
            resumeProbeTimer = setTimeout(function askAgain() {
              resumeProbeTimer = null;
              if (settled || conn.readyState !== WS_OPEN) return;
              conn.send({
                type: "turn.resume",
                id: newId(),
                timestamp: Date.now(),
                payload: { since: Math.max(0, sentAt - RESUME_MARGIN_MS), limit: 200 },
              });
            }, RESUME_PROBE_MS);
            return;
          }
          // Ход не идёт и кадров в буфере нет — реплику надо отправить заново.
          finish(
            reject,
            new AgentClientError("turn is not running", undefined, "turn_lost"),
          );
          return;
        }
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
        if (type === "message.delete") {
          // Сервер правит историю: сообщения с таким id больше нет.
          const deleted = str(payload.message_id);
          if (!deleted) {
            return;
          }
          if (reply && reply.id === deleted) {
            reply = null;
          }
          ev.onDelete?.(deleted);
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
    }

    conn.setHandlers({
      onMessage(frame) {
        handleFrame(frame);
      },
      onClose() {
        if (settled) {
          return;
        }
        // Сокет закрыли мы сами (конец хода, неудачная попытка) — не ошибка.
        if (!linkUp) {
          return;
        }
        linkUp = false;
        if (pendingError) {
          finish(reject, pendingError);
          return;
        }
        if (reply !== null) {
          finish(resolve, withAttachments());
          return;
        }
        // Связь пропала до ответа. В фоне это штатное поведение браузера:
        // молча переподключаемся и добираем кадры хода, ошибку показываем
        // только если восстановиться не удалось.
        void recover().then((ok) => {
          if (settled) return;
          if (ok) return;
          finish(reject, new AgentClientError("connection closed", undefined, "ws_closed"));
        });
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
          linkUp = true;
          lastFrameAt = Date.now();
          // Связь проверяем прикладным ping и в пассивном ожидании тоже.
          startPings();
          registered = { key: turnKey(agent.address, req.sessionId), cancel: requestCancel };
          activeTurns.add(registered);
          if (!shouldSend) {
            // Пассивное ожидание: ничего не отправляем, просим пропущенные кадры
            // (`turn.resume`) — так после закрытия приложения ответ подбирается
            // сразу, без окна ожидания. Старый сервер кадр просто проигнорирует.
            if (typeof req.resumeSince === "number" && req.resumeSince > 0) {
              conn.send({
                type: "turn.resume",
                id: newId(),
                timestamp: Date.now(),
                payload: { since: req.resumeSince, limit: 200 },
              });
            }
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
          sentAt = Date.now();
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
    capabilities: PICO_CAPABILITIES,
    send(req: TransportRequest, ev: TransportEvents): Promise<TransportReply> {
      return runTurn(req, ev, true, ctor);
    },
    listen(req: TransportRequest, ev: TransportEvents): Promise<TransportReply> {
      return runTurn(req, ev, false, ctor);
    },
    cancel(req: CancelRequest): Promise<CancelResult> {
      return cancelPicoTurn(req.agent.address, req.sessionId);
    },
    dispose() {
      // Соединение открывается на каждый ход и закрывается по завершении.
    },
  };
}

export const picoTransport = makePicoTransport();
