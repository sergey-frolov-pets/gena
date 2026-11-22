import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveTurns } from "./useLiveTurns";

describe("useLiveTurns", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("открывает ход с пустым стримом и счётчиком", () => {
    const api = useLiveTurns();
    api.open("s1");
    const turn = api.turnOf("s1");
    expect(turn).toBeTruthy();
    expect(turn?.streaming).toBe("");
    expect(turn?.typing).toBe(false);
    expect(api.count()).toBe(1);
    api.dispose();
  });

  it("правит поля и копит стрим только своего диалога", () => {
    const api = useLiveTurns();
    api.open("s1");
    api.open("s2");
    api.appendStream("s1", "при");
    api.appendStream("s1", "вет");
    api.appendStream("s2", "другое");
    api.patch("s1", { typing: true });
    expect(api.turnOf("s1")?.streaming).toBe("привет");
    expect(api.turnOf("s1")?.typing).toBe(true);
    expect(api.turnOf("s2")?.streaming).toBe("другое");
    api.dispose();
  });

  it("не падает, если ход уже закрыт", () => {
    const api = useLiveTurns();
    api.open("s1");
    api.close("s1");
    api.patch("s1", { typing: true });
    api.appendStream("s1", "x");
    expect(api.turnOf("s1")).toBeUndefined();
    expect(api.count()).toBe(0);
    api.dispose();
  });

  it("тикает, пока есть ход, и замирает после закрытия", () => {
    const api = useLiveTurns();
    api.open("s1");
    const start = api.now.value;
    vi.advanceTimersByTime(1_000);
    expect(api.now.value).toBeGreaterThan(start);
    api.close("s1");
    const frozen = api.now.value;
    vi.advanceTimersByTime(2_000);
    expect(api.now.value).toBe(frozen);
    api.dispose();
  });
});
