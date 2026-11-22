import { describe, expect, it } from "vitest";
import { isBusySession, liveSessionCount, pickRunnable } from "./turn-queue";

const item = (id: string, sessionId?: string) => ({ id, sessionId });

describe("isBusySession", () => {
  it("считает занятым диалог с идущим ходом", () => {
    expect(isBusySession({ s1: {} }, [], "s1")).toBe(true);
  });

  it("считает занятым диалог, где отправка уже началась", () => {
    expect(isBusySession({}, ["s2"], "s2")).toBe(true);
  });

  it("без id и с чужим id — не занят", () => {
    expect(isBusySession({ s1: {} }, [], undefined)).toBe(false);
    expect(isBusySession({ s1: {} }, [], "s9")).toBe(false);
  });
});

describe("liveSessionCount", () => {
  it("не считает один диалог дважды", () => {
    expect(liveSessionCount({ s1: {} }, ["s1", "s2"])).toBe(2);
  });

  it("пустое состояние — ноль", () => {
    expect(liveSessionCount({}, [])).toBe(0);
  });
});

describe("pickRunnable", () => {
  const queue = [item("a", "s1"), item("b", "s2"), item("c", "s3")];
  const busy = (id?: string) => id === "s1";

  it("берёт первую реплику свободного диалога, пропуская занятые", () => {
    expect(pickRunnable(queue, { isBusy: busy, live: 0, limit: 3 })?.id).toBe("b");
  });

  it("на потолке ходов не берёт ничего", () => {
    expect(pickRunnable(queue, { isBusy: busy, live: 3, limit: 3 })).toBeUndefined();
  });

  it("пропускает диалог, который просили не трогать", () => {
    expect(pickRunnable(queue, { isBusy: busy, live: 0, limit: 3, skipSessionId: "s2" })?.id).toBe(
      "c",
    );
  });

  it("все заняты — ничего", () => {
    expect(pickRunnable(queue, { isBusy: () => true, live: 0, limit: 3 })).toBeUndefined();
  });
});
