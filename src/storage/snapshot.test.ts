/**
 * Страховочная копия агентов и диалогов.
 *
 * Проверяем главное: копия пишется, читается, не воскрешает старьё и
 * не затирается пустым состоянием.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { Agent, Session } from "./types";
import { clearSnapshot, hasRestorableSnapshot, readSnapshot, writeSnapshot } from "./snapshot";

const agent: Agent = {
  id: "agent-1",
  name: "Агент",
  address: "https://example.test/api",
  sealedKey: "sealed",
  settings: { contextSize: 20, callLimit: 0, llmModel: "m", quickReplies: [] },
  protocol: "http_json",
  config: {},
  schemaVersion: 2,
  createdAt: 1,
  updatedAt: 2,
};

const session: Session = {
  id: "sess-1",
  agentId: "agent-1",
  title: "Диалог",
  createdAt: 1,
  updatedAt: 2,
  messageCount: 3,
};

afterEach(() => {
  clearSnapshot();
});

describe("storage/snapshot: копия агентов и диалогов", () => {
  it("пишется и читается целиком", () => {
    expect(writeSnapshot([agent], [session], 1000)).toBe(true);
    const snapshot = readSnapshot(1000);
    expect(snapshot?.at).toBe(1000);
    expect(snapshot?.agents.map((a) => a.id)).toEqual(["agent-1"]);
    expect(snapshot?.sessions.map((s) => s.id)).toEqual(["sess-1"]);
  });

  it("пустое состояние не затирает живую копию", () => {
    writeSnapshot([agent], [session], 1000);
    expect(writeSnapshot([], [], 2000)).toBe(false);
    expect(hasRestorableSnapshot(2000)).toBe(true);
  });

  it("просроченная копия не восстанавливается", () => {
    writeSnapshot([agent], [session], 1000);
    const tooOld = 1000 + 91 * 24 * 60 * 60 * 1000;
    expect(readSnapshot(tooOld)).toBeNull();
    expect(hasRestorableSnapshot(tooOld)).toBe(false);
  });

  it("мусор в хранилище не ломает запуск", () => {
    localStorage.setItem("gena.snapshot.v1", "{не json");
    expect(readSnapshot()).toBeNull();
    localStorage.setItem("gena.snapshot.v1", JSON.stringify({ v: 2 }));
    expect(readSnapshot()).toBeNull();
  });

  it("очистка убирает копию", () => {
    writeSnapshot([agent], [session], 1000);
    clearSnapshot();
    expect(readSnapshot(1000)).toBeNull();
  });
});
