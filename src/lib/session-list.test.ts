import { describe, expect, it } from "vitest";
import { matchesQuery, sortSessions, visibleSessions } from "./session-list";
import type { Session } from "@/storage/types";

function session(partial: Partial<Session> & { id: string }): Session {
  return {
    id: partial.id,
    agentId: partial.agentId ?? "a1",
    title: partial.title ?? "Диалог",
    createdAt: partial.createdAt ?? 1,
    updatedAt: partial.updatedAt ?? 1,
    messageCount: partial.messageCount ?? 0,
    pinned: partial.pinned,
  };
}

describe("session-list", () => {
  it("matchesQuery: пустой запрос пропускает всё, поиск без учёта регистра", () => {
    const s = session({ id: "1", title: "Вклады ВТБ" });
    expect(matchesQuery(s, "")).toBe(true);
    expect(matchesQuery(s, "   ")).toBe(true);
    expect(matchesQuery(s, "вклады")).toBe(true);
    expect(matchesQuery(s, "ВТБ")).toBe(true);
    expect(matchesQuery(s, "сбер")).toBe(false);
  });

  it("sortSessions: закреплённые сверху, дальше свежие первыми", () => {
    const list = [
      session({ id: "old", updatedAt: 10 }),
      session({ id: "new", updatedAt: 30 }),
      session({ id: "pinned", updatedAt: 5, pinned: true }),
    ];
    expect(sortSessions(list).map((s) => s.id)).toEqual(["pinned", "new", "old"]);
  });

  it("sortSessions не меняет исходный массив", () => {
    const list = [session({ id: "a", updatedAt: 1 }), session({ id: "b", updatedAt: 2 })];
    sortSessions(list);
    expect(list.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("visibleSessions: поиск и порядок вместе", () => {
    const list = [
      session({ id: "1", title: "Отпуск", updatedAt: 10 }),
      session({ id: "2", title: "Отпуск в Терскол", updatedAt: 20 }),
      session({ id: "3", title: "Вклады", updatedAt: 30 }),
    ];
    expect(visibleSessions(list, "отпуск").map((s) => s.id)).toEqual(["2", "1"]);
    expect(visibleSessions(list, "").map((s) => s.id)).toEqual(["3", "2", "1"]);
  });
});
