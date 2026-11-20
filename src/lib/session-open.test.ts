import { describe, expect, it } from "vitest";
import { shouldOpenLastSession } from "./session-open";

describe("shouldOpenLastSession", () => {
  it("ждёт, пока диалоги прочитаны", () => {
    expect(
      shouldOpenLastSession({ agentId: "agent-1", sessionsLoaded: false, activeSessionId: null }),
    ).toBe(false);
  });

  it("не трогает уже открытый диалог", () => {
    expect(
      shouldOpenLastSession({ agentId: "agent-1", sessionsLoaded: true, activeSessionId: "sess-1" }),
    ).toBe(false);
  });

  it("без агента ничего не открывает", () => {
    expect(
      shouldOpenLastSession({ agentId: null, sessionsLoaded: true, activeSessionId: null }),
    ).toBe(false);
  });

  it("агент выбран, диалоги прочитаны, диалога нет — открываем", () => {
    expect(
      shouldOpenLastSession({ agentId: "agent-1", sessionsLoaded: true, activeSessionId: null }),
    ).toBe(true);
  });
});
