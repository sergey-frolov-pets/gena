import { describe, expect, it } from "vitest";
import { answerElapsed, formatClock, formatDuration } from "./time";

describe("formatClock", () => {
  it("часы и минуты с ведущими нулями", () => {
    const ts = new Date(2026, 10, 20, 9, 5).getTime();
    expect(formatClock(ts)).toBe("09:05");
  });

  it("мусор и пустое время дают пустую строку", () => {
    expect(formatClock(0)).toBe("");
    expect(formatClock(Number.NaN)).toBe("");
    expect(formatClock(-1)).toBe("");
  });
});

describe("formatDuration", () => {
  it("меньше секунды", () => {
    expect(formatDuration(400)).toBe("<1 с");
  });

  it("секунды", () => {
    expect(formatDuration(42_400)).toBe("42 с");
  });

  it("минуты и секунды с ведущим нулём", () => {
    expect(formatDuration(65_000)).toBe("1 мин 05 с");
    expect(formatDuration(125_000)).toBe("2 мин 05 с");
  });

  it("часы без секунд", () => {
    expect(formatDuration(4 * 3_600_000 + 4 * 60_000)).toBe("4 ч 04 мин");
  });

  it("свои подписи единиц", () => {
    expect(formatDuration(65_000, { h: "h", m: "min", s: "sec" })).toBe("1 min 05 sec");
  });

  it("отрицательное время — пустая строка", () => {
    expect(formatDuration(-5)).toBe("");
  });
});

describe("answerElapsed", () => {
  const list = [
    { role: "user", createdAt: 1_000 },
    { role: "assistant", kind: "thought", createdAt: 4_000 },
    { role: "assistant", createdAt: 31_000 },
  ];

  it("записанное значение важнее разницы времени", () => {
    const withElapsed = [{ role: "user", createdAt: 1_000 }, { role: "assistant", createdAt: 2_000, elapsedMs: 900 }];
    expect(answerElapsed(withElapsed, 1)).toBe(900);
  });

  it("считает от ближайшей реплики пользователя", () => {
    expect(answerElapsed(list, 2)).toBe(30_000);
  });

  it("у реплики пользователя длительности нет", () => {
    expect(answerElapsed(list, 0)).toBeNull();
  });

  it("без реплики пользователя считать не из чего", () => {
    expect(answerElapsed([{ role: "assistant", createdAt: 5 }], 0)).toBeNull();
  });
});
