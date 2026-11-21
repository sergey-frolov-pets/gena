/**
 * Автомат одного хода.
 *
 * Компонент и транспорт только шлют события. Повторная отправка и обрыв
 * сокета решаются здесь, а не набором независимых флагов.
 */

export type TurnPhase =
  | "idle"
  | "queued"
  | "sending"
  | "streaming"
  | "settling"
  | "reconnecting"
  | "failed";

export interface TurnState {
  phase: TurnPhase;
  /** Сколько раз уже уходили в переподключение в этом ходе. */
  attempt: number;
  maxAttempts: number;
  clientTurnId: string | null;
  text: string;
}

export const DEFAULT_MAX_ATTEMPTS = 6;

export function idleTurn(maxAttempts = DEFAULT_MAX_ATTEMPTS): TurnState {
  return {
    phase: "idle",
    attempt: 0,
    maxAttempts,
    clientTurnId: null,
    text: "",
  };
}

export type TurnEvent =
  | { type: "enqueue"; clientTurnId: string; text: string }
  | { type: "start" }
  | { type: "delta" }
  | { type: "socketClosed" }
  | { type: "resume" }
  | { type: "complete" }
  | { type: "fail" }
  | { type: "stop" }
  | { type: "notice" };

const ACTIVE: ReadonlySet<TurnPhase> = new Set([
  "sending",
  "streaming",
  "reconnecting",
  "settling",
]);

/** Следующую реплику очереди можно брать, только когда ход не занят. */
export function canTakeNext(phase: TurnPhase): boolean {
  return phase === "idle" || phase === "failed";
}

export function stepTurn(state: TurnState, event: TurnEvent): TurnState {
  switch (event.type) {
    case "notice":
      return state;
    case "enqueue":
      if (!canTakeNext(state.phase)) return state;
      return {
        ...state,
        phase: "queued",
        attempt: 0,
        clientTurnId: event.clientTurnId,
        text: event.text,
      };
    case "start":
      if (state.phase !== "queued") return state;
      return { ...state, phase: "sending" };
    case "delta":
      if (state.phase === "sending" || state.phase === "reconnecting" || state.phase === "streaming") {
        return { ...state, phase: "streaming" };
      }
      return state;
    case "socketClosed": {
      if (state.phase !== "sending" && state.phase !== "streaming" && state.phase !== "reconnecting") {
        return state;
      }
      if (state.attempt >= state.maxAttempts) {
        return { ...state, phase: "failed" };
      }
      return { ...state, phase: "reconnecting", attempt: state.attempt + 1 };
    }
    case "resume":
      if (state.phase !== "reconnecting") return state;
      return { ...state, phase: "streaming" };
    case "complete":
      if (state.phase === "idle") return state;
      return { ...idleTurn(state.maxAttempts), phase: "idle" };
    case "fail":
      if (!ACTIVE.has(state.phase) && state.phase !== "queued") return state;
      return { ...state, phase: "failed" };
    case "stop":
      if (state.phase === "idle") return state;
      return { ...idleTurn(state.maxAttempts), phase: "idle" };
    default:
      return state;
  }
}
