import { describe, expect, it } from "vitest";
import type { Message } from "@/storage/types";
import {
  anyStepOpen,
  collectTrailingSteps,
  collectTurnSteps,
  isStepMessage,
  setStepOpen,
  setStepsOpen,
} from "./turns";

function msg(id: string, role: Message["role"], kind?: Message["kind"]): Message {
  return {
    id,
    sessionId: "s1",
    role,
    content: id,
    createdAt: 0,
    kind,
  };
}

describe("шаги хода", () => {
  it("шаг — только thought и tool_calls", () => {
    expect(isStepMessage(msg("a", "assistant", "thought"))).toBe(true);
    expect(isStepMessage(msg("b", "assistant", "tool_calls"))).toBe(true);
    expect(isStepMessage(msg("c", "assistant"))).toBe(false);
    expect(isStepMessage(msg("d", "user"))).toBe(false);
    expect(isStepMessage(msg("e", "assistant", "text"))).toBe(false);
  });

  it("находит все шаги перед ответом и останавливается на реплике", () => {
    const list = [
      msg("u1", "user"),
      msg("t1", "assistant", "thought"),
      msg("c1", "assistant", "tool_calls"),
      msg("a1", "assistant"),
      msg("u2", "user"),
      msg("t2", "assistant", "thought"),
      msg("a2", "assistant"),
    ];

    expect(collectTurnSteps(list, 3).map((m) => m.id)).toEqual(["t1", "c1"]);
    expect(collectTurnSteps(list, 6).map((m) => m.id)).toEqual(["t2"]);
    expect(collectTurnSteps(list, 0)).toEqual([]);
  });

  it("без шагов перед ответом возвращает пустой список", () => {
    const list = [msg("u1", "user"), msg("a1", "assistant")];
    expect(collectTurnSteps(list, 1)).toEqual([]);
  });

  it("шаги текущего хода — те, что в конце ленты", () => {
    const list = [msg("u1", "user"), msg("a1", "assistant"), msg("t2", "assistant", "thought")];
    expect(collectTrailingSteps(list).map((m) => m.id)).toEqual(["t2"]);
    expect(collectTrailingSteps([msg("u1", "user")])).toEqual([]);
  });

  it("разворачивает и сворачивает всю цепочку разом", () => {
    const steps = [msg("t1", "assistant", "thought"), msg("c1", "assistant", "tool_calls")];

    const opened = setStepsOpen({}, steps, true);
    expect(anyStepOpen(opened, steps)).toBe(true);
    expect(opened).toEqual({ t1: true, c1: true });

    const closed = setStepsOpen(opened, steps, false);
    expect(anyStepOpen(closed, steps)).toBe(false);
    expect(closed).toEqual({});
  });

  it("не трогает состояние шагов других ходов", () => {
    const other = [msg("t9", "assistant", "thought")];
    const steps = [msg("t1", "assistant", "thought")];
    const next = setStepsOpen({ t9: true }, steps, false);
    expect(next).toEqual({ t9: true });
    expect(other).toHaveLength(1);
  });

  it("ручное раскрытие одного шага не переключает остальные", () => {
    const opened = setStepOpen({}, "t1", true);
    expect(opened).toEqual({ t1: true });
    expect(setStepOpen(opened, "t1", false)).toEqual({});
  });
});
