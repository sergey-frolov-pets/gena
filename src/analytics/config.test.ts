import { describe, expect, it } from "vitest";
import {
  DEFAULT_GOATCOUNTER_ORIGIN,
  isAnalyticsEnabled,
  resolveGoatCounterCountUrl,
  resolveGoatCounterOrigin,
} from "./config";

describe("goatcounter origin", () => {
  it("без переменной берёт хост Gena", () => {
    expect(resolveGoatCounterOrigin(undefined)).toBe(DEFAULT_GOATCOUNTER_ORIGIN);
    expect(resolveGoatCounterCountUrl(undefined)).toBe(`${DEFAULT_GOATCOUNTER_ORIGIN}/count`);
    expect(isAnalyticsEnabled(undefined)).toBe(true);
  });

  it("пустая строка выключает статистику", () => {
    expect(resolveGoatCounterOrigin("")).toBe("");
    expect(resolveGoatCounterCountUrl("")).toBe("");
    expect(isAnalyticsEnabled("  ")).toBe(false);
  });

  it("свой адрес без хвостового слэша", () => {
    expect(resolveGoatCounterOrigin("https://stats.example.com/")).toBe("https://stats.example.com");
    expect(resolveGoatCounterCountUrl("https://stats.example.com/")).toBe(
      "https://stats.example.com/count",
    );
  });
});
