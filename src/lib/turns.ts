/**
 * Шаги хода: мысли агента (`thought`) и вызовы инструментов (`tool_calls`).
 *
 * Шаги живут в ленте отдельными облачками и всегда по умолчанию свёрнуты.
 * Кнопка в облачке ответа разворачивает/сворачивает все шаги этого хода разом,
 * поэтому связывание «шаг → ответ» вынесено в чистые функции и покрыто тестами.
 */

import type { Message } from "@/storage/types";

/** Состояние раскрытия шагов: id сообщения → развёрнуто. */
export type StepOpenMap = Record<string, boolean>;

/** Шаг хода — мысль или вызов инструментов, а не реплика/ответ. */
export function isStepMessage(message: Pick<Message, "kind">): boolean {
  return message.kind === "thought" || message.kind === "tool_calls";
}

/**
 * Лента для показа: без вызовов инструментов. В хранилище они остаются —
 * скрытие чисто презентационное.
 */
export function withoutToolCalls(list: readonly Message[]): Message[] {
  return list.filter((message) => message.kind !== "tool_calls");
}

/**
 * Шаги ответа с индексом `answerIndex` в ленте: непрерывная цепочка шагов
 * непосредственно перед ответом. Всё, что дальше вверх (реплика пользователя
 * или предыдущий ответ), к этому ходу уже не относится.
 */
export function collectTurnSteps(list: readonly Message[], answerIndex: number): Message[] {
  const steps: Message[] = [];
  const start = Math.min(answerIndex, list.length) - 1;
  for (let i = start; i >= 0; i -= 1) {
    const message = list[i];
    if (!isStepMessage(message)) break;
    steps.unshift(message);
  }
  return steps;
}

/** Шаги последнего (ещё не завершённого) хода — те, что идут в конце ленты. */
export function collectTrailingSteps(list: readonly Message[]): Message[] {
  return collectTurnSteps(list, list.length);
}

/**
 * Только размышления хода: все `thought` перед ответом (или в конце ленты).
 * Несколько мыслей одного хода показываются одной свёртываемой областью.
 */
export function collectTurnThoughts(list: readonly Message[], answerIndex: number): Message[] {
  return collectTurnSteps(list, answerIndex).filter((message) => message.kind === "thought");
}

/** Размышления текущего (незавершённого) хода. */
export function collectTrailingThoughts(list: readonly Message[]): Message[] {
  return collectTrailingSteps(list).filter((message) => message.kind === "thought");
}

/** Текст единого блока размышлений: мысли склеены пустой строкой. */
export function thoughtText(list: readonly Message[]): string {
  return list
    .map((message) => message.content.trim())
    .filter((text) => text.length > 0)
    .join("\n\n");
}

/** Развёрнут ли хотя бы один шаг хода. */
export function anyStepOpen(open: Readonly<StepOpenMap>, steps: readonly Message[]): boolean {
  return steps.some((step) => open[step.id] === true);
}

/** Новая карта состояния: все шаги хода развёрнуты (`expanded`) либо свёрнуты. */
export function setStepsOpen(
  open: Readonly<StepOpenMap>,
  steps: readonly Message[],
  expanded: boolean,
): StepOpenMap {
  const next: StepOpenMap = { ...open };
  for (const step of steps) {
    if (expanded) next[step.id] = true;
    else delete next[step.id];
  }
  return next;
}

/** Новое состояние с одним изменённым шагом (ручное раскрытие конкретного облачка). */
export function setStepOpen(
  open: Readonly<StepOpenMap>,
  stepId: string,
  expanded: boolean,
): StepOpenMap {
  const next: StepOpenMap = { ...open };
  if (expanded) next[stepId] = true;
  else delete next[stepId];
  return next;
}
