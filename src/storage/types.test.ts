import { describe, expect, it } from "vitest";
import {
  MAX_QUICK_REPLIES,
  normalizeAgent,
  normalizeQuickReplies,
  QUICK_REPLY_MAX_LEN,
  SCHEMA_VERSION,
  type Agent,
  toCount,
} from "./types";

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

describe("normalizeQuickReplies", () => {
  it("текст из формы: по строке на сообщение, пустые и дубли отбрасываются", () => {
    expect(normalizeQuickReplies("Привет\n\n  Как дела?  \nПривет\n")).toEqual([
      "Привет",
      "Как дела?",
    ]);
  });

  it("массив тоже принимается", () => {
    expect(normalizeQuickReplies(["Спасибо", "", 42 as unknown as string])).toEqual([
      "Спасибо",
      "42",
    ]);
  });

  it("лишние пробелы схлопываются, длина обрезается", () => {
    const long = "я".repeat(QUICK_REPLY_MAX_LEN + 50);
    const [only] = normalizeQuickReplies(`  a   b  \n${long}`);
    expect(only).toBe("a b");
    expect(normalizeQuickReplies(long)[0]).toHaveLength(QUICK_REPLY_MAX_LEN);
  });

  it("не больше лимита сообщений", () => {
    const many = Array.from({ length: MAX_QUICK_REPLIES + 5 }, (_, i) => `msg ${i}`);
    expect(normalizeQuickReplies(many)).toHaveLength(MAX_QUICK_REPLIES);
  });

  it("мусор и пустое → пустой список", () => {
    expect(normalizeQuickReplies(undefined)).toEqual([]);
    expect(normalizeQuickReplies("")).toEqual([]);
    expect(normalizeQuickReplies({})).toEqual([]);
  });
});

describe("normalizeAgent · стандартные сообщения", () => {
  it("у старого агента появляется пустой список", () => {
    const n = normalizeAgent(baseAgent());
    expect(n.settings.quickReplies).toEqual([]);
  });

  it("сохранённые сообщения нормализуются", () => {
    const n = normalizeAgent(
      baseAgent({
        settings: {
          contextSize: 20,
          callLimit: 0,
          llmModel: "",
          quickReplies: [" a ", "a", ""],
        },
      }),
    );
    expect(n.settings.quickReplies).toEqual(["a"]);
  });
});
