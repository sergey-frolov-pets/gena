import { describe, expect, it } from "vitest";
import {
  accessDateToStore,
  formatAccessDate,
  parseAccessDate,
  serverAccessState,
} from "./server-access";

/** Полночь по местным часам — чтобы расчёт дней не зависел от часа запуска. */
function at(y: number, m: number, d: number, h = 0): number {
  return new Date(y, m - 1, d, h, 0, 0).getTime();
}

describe("parseAccessDate", () => {
  it("дата без времени значит «до конца дня»", () => {
    const parsed = parseAccessDate("2026-12-31");
    expect(parsed).not.toBeNull();
    expect(parsed!.getHours()).toBe(23);
    expect(parsed!.getDate()).toBe(31);
  });

  it("понимает полный ISO", () => {
    const parsed = parseAccessDate("2026-12-31T10:00:00Z");
    expect(parsed!.toISOString()).toBe("2026-12-31T10:00:00.000Z");
  });

  it("пустое и мусорное значение — null", () => {
    expect(parseAccessDate("")).toBeNull();
    expect(parseAccessDate("   ")).toBeNull();
    expect(parseAccessDate(undefined)).toBeNull();
    expect(parseAccessDate("не дата")).toBeNull();
    expect(parseAccessDate("2026-13-45")).toBeNull();
  });
});

describe("formatAccessDate", () => {
  it("выводит ДД.ММ.ГГГГ с ведущими нулями", () => {
    expect(formatAccessDate(new Date(2027, 0, 5))).toBe("05.01.2027");
  });
});

describe("serverAccessState", () => {
  it("без даты — тон none", () => {
    expect(serverAccessState(undefined, at(2026, 11, 28))).toEqual({ tone: "none", date: "", days: 0 });
    expect(serverAccessState("", at(2026, 11, 28)).tone).toBe("none");
  });

  it("далёкая дата — ok, дни считаются вверх", () => {
    const state = serverAccessState("2026-12-31", at(2026, 11, 28));
    expect(state.tone).toBe("ok");
    expect(state.date).toBe("31.12.2026");
    expect(state.days).toBe(34);
  });

  it("последняя неделя — soon", () => {
    expect(serverAccessState("2026-12-31", at(2026, 12, 26)).tone).toBe("soon");
    expect(serverAccessState("2026-12-31", at(2026, 12, 24)).tone).toBe("ok");
  });

  it("последний день — soon и days = 1", () => {
    const state = serverAccessState("2026-12-31", at(2026, 12, 31, 12));
    expect(state.tone).toBe("soon");
    expect(state.days).toBe(1);
  });

  it("после срока — expired и days = 0", () => {
    const state = serverAccessState("2026-12-31", at(2027, 1, 3));
    expect(state.tone).toBe("expired");
    expect(state.days).toBe(0);
  });
});

describe("accessDateToStore", () => {
  it("дата из input[type=date] сохраняется как ISO", () => {
    const stored = accessDateToStore("2026-12-31");
    expect(parseAccessDate(stored)!.getDate()).toBe(31);
  });

  it("пустое поле очищает срок", () => {
    expect(accessDateToStore("")).toBe("");
  });
});
