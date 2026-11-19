import { describe, expect, it } from "vitest";
import { normalizeAgent, SCHEMA_VERSION, type Agent, toCount } from "./types";

function baseAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "a1",
    name: "A",
    address: "https://x.test/chat",
    sealedKey: "",
    settings: { contextSize: 20, callLimit: 0, llmModel: "" },
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("normalizeAgent", () => {
  it("нет protocol/config → http_json, пустой config, schemaVersion 1", () => {
    const n = normalizeAgent(baseAgent());
    expect(n.protocol).toBe("http_json");
    expect(n.config).toEqual({});
    expect(n.schemaVersion).toBe(1);
  });

  it("идемпотентность: повторный вызов даёт тот же результат", () => {
    const once = normalizeAgent(baseAgent());
    const twice = normalizeAgent(once);
    expect(twice).toEqual(once);
  });

  it("явный протокол сохраняется, schemaVersion = 2", () => {
    const n = normalizeAgent(baseAgent({ protocol: "openai", config: { model: "m" } }));
    expect(n.protocol).toBe("openai");
    expect(n.config).toEqual({ model: "m" });
    expect(n.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("не мутирует исходный объект", () => {
    const raw = baseAgent();
    normalizeAgent(raw);
    expect(raw.protocol).toBeUndefined();
    expect(raw.config).toBeUndefined();
  });
});

describe("toCount", () => {
  it("отрицательные, дробные и мусор → целое ≥ 0", () => {
    expect(toCount(-5)).toBe(0);
    expect(toCount("12.7")).toBe(13);
    expect(toCount(" 8 ")).toBe(8);
    expect(toCount("abc")).toBe(0);
    expect(toCount(undefined)).toBe(0);
    expect(toCount(NaN)).toBe(0);
    expect(toCount(Infinity)).toBe(0);
  });
});
