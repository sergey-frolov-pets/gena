import { beforeEach, describe, expect, it } from "vitest";
import { canCall, getCallCount, recordCall, remainingCalls, resetUsage, utcDay } from "./usage";
import { closeDb } from "./db";

const AGENT = "agent-usage-1";

describe("usage (дневной лимит вызовов)", () => {
  beforeEach(async () => {
    await closeDb();
    await resetUsage(AGENT);
  });

  it("utcDay отдаёт YYYY-MM-DD в UTC", () => {
    const day = utcDay(Date.UTC(2026, 10, 19, 23, 59, 59));
    expect(day).toBe("2026-11-19");
  });

  it("пустой счётчик: 0 вызовов, можно звать", async () => {
    expect(await getCallCount(AGENT)).toBe(0);
    expect(await canCall(AGENT, 1)).toBe(true);
    expect(await remainingCalls(AGENT, 3)).toBe(3);
  });

  it("limit <= 0 — без лимита", async () => {
    expect(await canCall(AGENT, 0)).toBe(true);
    expect(await canCall(AGENT, -5)).toBe(true);
    expect(await remainingCalls(AGENT, 0)).toBe(Infinity);
  });

  it("после N вызовов лимит N исчерпан", async () => {
    await recordCall(AGENT);
    expect(await getCallCount(AGENT)).toBe(1);
    expect(await canCall(AGENT, 1)).toBe(false);
    expect(await remainingCalls(AGENT, 2)).toBe(1);

    await recordCall(AGENT);
    expect(await canCall(AGENT, 2)).toBe(false);
    expect(await remainingCalls(AGENT, 2)).toBe(0);
  });

  it("счётчик сбрасывается при смене дня", async () => {
    const day1 = Date.UTC(2026, 10, 19, 10, 0, 0);
    const day2 = Date.UTC(2026, 10, 20, 0, 0, 1);

    await recordCall(AGENT, day1);
    await recordCall(AGENT, day1);
    expect(await getCallCount(AGENT, day1)).toBe(2);
    expect(await canCall(AGENT, 2, day1)).toBe(false);

    // Новый день — счётчик читается как 0.
    expect(await getCallCount(AGENT, day2)).toBe(0);
    expect(await canCall(AGENT, 2, day2)).toBe(true);

    await recordCall(AGENT, day2);
    expect(await getCallCount(AGENT, day2)).toBe(1);
  });

  it("записи разных агентов не пересекаются", async () => {
    const other = "agent-usage-2";
    await resetUsage(other);
    await recordCall(AGENT);
    expect(await getCallCount(AGENT)).toBe(1);
    expect(await getCallCount(other)).toBe(0);
    await resetUsage(other);
  });
});
