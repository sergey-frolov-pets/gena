/**
 * Состояние ходов по диалогам.
 *
 * Раньше чат держал «один ход на всё приложение»: пока агент отвечает в одном
 * диалоге, реплика из другого вставала в общую очередь. Теперь у каждого
 * диалога свой ход и своя очередь, а компонент читает это состояние отсюда.
 */

import { ref, type Ref } from "vue";
import { idleTurn, type TurnState } from "@/turn/machine";

export interface LiveTurn {
  sessionId: string;
  /** Агент «печатает» в этом диалоге. */
  typing: boolean;
  /** Накопленный текст стрима (только для этого диалога). */
  streaming: string;
  /** Когда отправлен запрос — для живого счётчика. */
  startedAt: number;
  /** Отмена локального запроса. */
  controller: AbortController | null;
  /** Остановлен кнопкой «Стоп» — ошибкой это не показываем. */
  stoppedByUser: boolean;
  /** Отмена на сервере уже запрошена — второе нажатие не дублируем. */
  stopping: boolean;
  /** Состояние шага хода (мысли, инструменты, ответ). */
  state: TurnState;
}

/** Период тикающего счётчика хода. */
const CLOCK_TICK_MS = 500;

export interface LiveTurns {
  /** Ходы по id диалога (реактивно). */
  turns: Ref<Record<string, LiveTurn>>;
  /** Тикающая метка времени для счётчиков; обновляется, пока идёт ход. */
  now: Ref<number>;
  turnOf(sessionId: string | null | undefined): LiveTurn | undefined;
  open(sessionId: string): LiveTurn;
  patch(sessionId: string, patch: Partial<LiveTurn>): void;
  close(sessionId: string): void;
  appendStream(sessionId: string, chunk: string): void;
  count(): number;
  /** Остановить таймер (размонтирование компонента). */
  dispose(): void;
}

export function useLiveTurns(): LiveTurns {
  const turns = ref<Record<string, LiveTurn>>({});
  const now = ref(Date.now());
  let timer: ReturnType<typeof setInterval> | null = null;

  function syncClock(): void {
    const needed = Object.keys(turns.value).length > 0;
    if (needed && !timer) {
      now.value = Date.now();
      timer = setInterval(() => {
        now.value = Date.now();
      }, CLOCK_TICK_MS);
    } else if (!needed && timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function turnOf(sessionId: string | null | undefined): LiveTurn | undefined {
    return sessionId ? turns.value[sessionId] : undefined;
  }

  function open(sessionId: string): LiveTurn {
    const turn: LiveTurn = {
      sessionId,
      typing: false,
      streaming: "",
      startedAt: Date.now(),
      controller: null,
      stoppedByUser: false,
      stopping: false,
      state: idleTurn(),
    };
    turns.value = { ...turns.value, [sessionId]: turn };
    syncClock();
    return turn;
  }

  function patch(sessionId: string, fields: Partial<LiveTurn>): void {
    const current = turns.value[sessionId];
    if (!current) return;
    turns.value = { ...turns.value, [sessionId]: { ...current, ...fields } };
  }

  function close(sessionId: string): void {
    if (!turns.value[sessionId]) return;
    const rest = { ...turns.value };
    delete rest[sessionId];
    turns.value = rest;
    syncClock();
  }

  function appendStream(sessionId: string, chunk: string): void {
    const current = turns.value[sessionId];
    if (!current) return;
    patch(sessionId, { streaming: current.streaming + chunk });
  }

  function count(): number {
    return Object.keys(turns.value).length;
  }

  function dispose(): void {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { turns, now, turnOf, open, patch, close, appendStream, count, dispose };
}
