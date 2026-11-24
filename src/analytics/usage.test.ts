import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, Session } from "@/storage/types";
import { trackEvent } from "./goatcounter";
import {
  agentEvents,
  agentTypeOf,
  analyticsSlug,
  emptyUsageState,
  modelsOf,
  reportAgentUse,
  resetUsageMemory,
  type UsageState,
} from "./usage";

vi.mock("./goatcounter", () => ({ trackEvent: vi.fn() }));

function agent(partial: Partial<Agent>): Agent {
  return {
    id: "a",
    name: "Секретное имя",
    address: "https://secret.example/v1",
    sealedKey: "enc:v1:nope",
    settings: { contextSize: 8, callLimit: 0, llmModel: "" },
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

function session(id = "s", tokenMode?: boolean): Session {
  return {
    id,
    agentId: "a",
    title: "личный диалог",
    createdAt: 0,
    updatedAt: 0,
    messageCount: 3,
    tokenMode,
  };
}

const empty: UsageState = { ...emptyUsageState };

describe("путь отчёта", () => {
  it("режет всё, кроме безопасного пути", () => {
    expect(analyticsSlug("GPT 4.1 Mini")).toBe("gpt-4.1-mini");
    expect(analyticsSlug("https://evil")).toBe("https-evil");
    expect(analyticsSlug("   ")).toBe("unknown");
  });

  it("берёт модель openai и pico_ws, не адрес", () => {
    expect(modelsOf(agent({ protocol: "openai", config: { model: "gpt-4o-mini" } }))).toEqual([
      "gpt-4o-mini",
    ]);
    expect(modelsOf(agent({ protocol: "openai", config: {}, settings: { contextSize: 1, callLimit: 0, llmModel: "gpt-4o" } }))).toEqual([
      "gpt-4o",
    ]);
    expect(
      modelsOf(agent({ protocol: "pico_ws", settings: { contextSize: 1, callLimit: 0, llmModel: "" } })),
    ).toEqual(["default"]);
  });

  it("пул и сводка выключены: моделей нет и событий по ним нет", () => {
    expect(
      modelsOf(agent({ protocol: "model_pool", config: { models: [{ id: "a" }, { id: "b" }] } })),
    ).toEqual([]);
    expect(
      modelsOf(agent({ protocol: "model_mix", config: { routes: [{ agentId: "x", model: "claude" }] } })),
    ).toEqual([]);
    const pool = agent({ protocol: "model_pool", config: { models: [{ id: "a" }] } });
    const { events } = agentEvents(pool, session("s1"), "ru", empty, "2026-11-24");
    expect(events).toEqual(["language/ru", "chat/plain"]);
  });
});

describe("тип агента", () => {
  it("узнаёт по настройкам", () => {
    expect(agentTypeOf(agent({ protocol: "pico_ws", address: "ws://127.0.0.1:18790" }))).toBe("picoclaw");
    expect(agentTypeOf(agent({ protocol: "openai", config: { model: "openclaw/default" } }))).toBe(
      "openclaw",
    );
    expect(agentTypeOf(agent({ protocol: "openai", config: { model: "hermes-agent" } }))).toBe("hermes");
  });

  it("узнаёт по адресу и порту", () => {
    expect(agentTypeOf(agent({ protocol: "openai", config: { model: "x" }, address: "http://127.0.0.1:18789/v1" }))).toBe(
      "openclaw",
    );
    expect(agentTypeOf(agent({ protocol: "openai", config: { model: "x" }, address: "http://box.local:8642/v1" }))).toBe(
      "hermes",
    );
    expect(agentTypeOf(agent({ protocol: "pico_ws", address: "ws://127.0.0.1:18790" }))).toBe("picoclaw");
    expect(agentTypeOf(agent({ protocol: "openai", config: { model: "x" }, address: "https://hermes.example/v1" }))).toBe(
      "hermes",
    );
  });

  it("неизвестный — custom, адрес в отчёт не уходит", () => {
    expect(agentTypeOf(agent({ protocol: "openai", config: { model: "gpt-4o" } }))).toBe("custom");
    const { events } = agentEvents(
      agent({ protocol: "openai", config: { model: "gpt-4o" } }),
      session("s1"),
      "ru",
      empty,
      "2026-11-24",
    );
    expect(events.join(" ")).not.toContain("secret.example");
  });
});

describe("события первого успешного запроса", () => {
  it("уходят сразу все виды: язык, протокол, тип, модель и две пары, диалог", () => {
    const openai = agent({ protocol: "openai", config: { model: "gpt-4o" } });
    const { events, state } = agentEvents(openai, session("s1"), "ru", empty, "2026-11-24");
    expect(events).toEqual([
      "language/ru",
      "protocol/openai",
      "agent/custom",
      "model/gpt-4o",
      "protocol/openai/gpt-4o",
      "agent/custom/gpt-4o",
      "chat/plain",
    ]);
    expect(state).toEqual({
      day: "2026-11-24",
      providers: ["openai"],
      agents: ["custom"],
      models: ["gpt-4o"],
      pairs: ["openai/gpt-4o"],
      agentPairs: ["custom/gpt-4o"],
      chats: ["s1|plain"],
    });
    expect(events.join(" ")).not.toContain("личный");
    expect(events.join(" ")).not.toContain("secret");
    expect(events.join(" ")).not.toContain("Секретное");
  });

  it("openclaw: тип по модели, в путях и парах он же", () => {
    const openclaw = agent({
      protocol: "openai",
      config: { model: "openclaw/default" },
      address: "http://127.0.0.1:18789/v1",
    });
    const { events } = agentEvents(openclaw, session("s1"), "ru", empty, "2026-11-24");
    expect(events).toEqual([
      "language/ru",
      "protocol/openai",
      "agent/openclaw",
      "model/openclaw-default",
      "protocol/openai/openclaw-default",
      "agent/openclaw/openclaw-default",
      "chat/plain",
    ]);
  });

  it("повторный запрос в тот же диалог и к тому же подключению — тишина", () => {
    const openai = agent({ protocol: "openai", config: { model: "gpt-4o" } });
    const first = agentEvents(openai, session("s1"), "ru", empty, "2026-11-24");
    const second = agentEvents(openai, session("s1"), "ru", first.state, "2026-11-24");
    expect(second.events).toEqual([]);
    expect(second.state).toEqual(first.state);
  });

  it("новый диалог того же подключения — только тип диалога", () => {
    const openai = agent({ protocol: "openai", config: { model: "gpt-4o" } });
    const first = agentEvents(openai, session("s1"), "ru", empty, "2026-11-24");
    const second = agentEvents(openai, session("s2", true), "ru", first.state, "2026-11-24");
    expect(second.events).toEqual(["chat/token"]);
    expect(second.state.chats).toEqual(["s1|plain", "s2|token"]);
  });

  it("смена режима в том же диалоге — второй чат, а не тот же", () => {
    const openai = agent({ protocol: "openai", config: { model: "gpt-4o" } });
    const plain = agentEvents(openai, session("s1"), "ru", empty, "2026-11-24");
    const token = agentEvents(openai, session("s1", true), "ru", plain.state, "2026-11-24");
    expect(token.events).toEqual(["chat/token"]);
    expect(token.state.chats).toEqual(["s1|plain", "s1|token"]);
    const back = agentEvents(openai, session("s1"), "ru", token.state, "2026-11-24");
    expect(back.events).toEqual([]);
  });

  it("защищённый диалог, из которого вышли в обычный, тоже считается дважды", () => {
    const openai = agent({ protocol: "openai", config: { model: "gpt-4o" } });
    const token = agentEvents(openai, session("s1", true), "ru", empty, "2026-11-24");
    expect(token.events).toContain("chat/token");
    const plain = agentEvents(openai, session("s1", false), "ru", token.state, "2026-11-24");
    expect(plain.events).toEqual(["chat/plain"]);
    expect(plain.state.chats).toEqual(["s1|token", "s1|plain"]);
  });

  it("другой агент в тот же день: новый тип, модель и пары, протокол уже был", () => {
    const openai = agent({ protocol: "openai", config: { model: "gpt-4o" } });
    const hermes = agent({
      id: "b",
      protocol: "openai",
      address: "http://127.0.0.1:8642/v1",
      config: { model: "hermes-agent" },
    });
    const first = agentEvents(openai, session("s1"), "ru", empty, "2026-11-24");
    const second = agentEvents(hermes, session("s2"), "ru", first.state, "2026-11-24");
    expect(second.events).toEqual([
      "agent/hermes",
      "model/hermes-agent",
      "protocol/openai/hermes-agent",
      "agent/hermes/hermes-agent",
      "chat/plain",
    ]);
  });

  it("новые сутки — только язык, протоколы и модели не повторяются", () => {
    const openai = agent({ protocol: "openai", config: { model: "gpt-4o" } });
    const first = agentEvents(openai, session("s1"), "ru", empty, "2026-11-24");
    const nextDay = agentEvents(openai, session("s1"), "ru", first.state, "2026-11-25");
    expect(nextDay.events).toEqual(["language/ru"]);
    expect(nextDay.state.chats).toEqual(["s1|plain"]);
  });

  it("модель из ответа точнее настройки", () => {
    const openai = agent({ protocol: "openai", config: { model: "gpt-4o" } });
    const { events, state } = agentEvents(openai, session("s1"), "ru", empty, "2026-11-24", "real-model");
    expect(events).toEqual([
      "language/ru",
      "protocol/openai",
      "agent/custom",
      "model/real-model",
      "protocol/openai/real-model",
      "agent/custom/real-model",
      "chat/plain",
    ]);
    expect(state.models).toEqual(["real-model"]);
  });

  it("кириллица в названии модели не ломает путь отчёта", () => {
    const { events } = agentEvents(
      agent({ protocol: "openai", config: { model: "Модель" } }),
      session("s1"),
      "ru",
      empty,
      "2026-11-24",
    );
    expect(events).toContain("protocol/openai/unknown");
    expect(events).toContain("agent/custom/unknown");
    expect(events).toContain("model/unknown");
  });
});

describe("отправка после успешного ответа", () => {
  const calls = () => vi.mocked(trackEvent).mock.calls.map(([name]) => name);

  beforeEach(() => {
    vi.mocked(trackEvent).mockClear();
    globalThis.localStorage?.clear();
    resetUsageMemory();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("первый запрос уходит сразу, повторный — нет", () => {
    const openai = agent({ protocol: "openai", config: { model: "gpt-4o" } });
    reportAgentUse(openai, session("s1"), "ru");
    expect(calls()).toEqual([
      "language/ru",
      "protocol/openai",
      "agent/custom",
      "model/gpt-4o",
      "protocol/openai/gpt-4o",
      "agent/custom/gpt-4o",
      "chat/plain",
    ]);
    reportAgentUse(openai, session("s1"), "ru");
    expect(calls()).toHaveLength(7);
  });

  it("после перезагрузки страницы повтор не уходит (состояние в хранилище)", () => {
    const openai = agent({ protocol: "openai", config: { model: "gpt-4o" } });
    reportAgentUse(openai, session("s1"), "ru");
    vi.mocked(trackEvent).mockClear();
    // Новый запуск приложения: состояние читается из хранилища.
    reportAgentUse(openai, session("s1"), "ru");
    expect(calls()).toEqual([]);
    reportAgentUse(openai, session("s2"), "ru");
    expect(calls()).toEqual(["chat/plain"]);
  });

  it("смена режима в том же диалоге уходит как второй чат", () => {
    const openai = agent({ protocol: "openai", config: { model: "gpt-4o" } });
    reportAgentUse(openai, session("s1"), "ru");
    vi.mocked(trackEvent).mockClear();
    reportAgentUse(openai, session("s1", true), "ru");
    expect(calls()).toEqual(["chat/token"]);
    vi.mocked(trackEvent).mockClear();
    reportAgentUse(openai, session("s1", true), "ru");
    expect(calls()).toEqual([]);
  });

  it("приватный режим: хранилище не пишется, но повтор молчит", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    const openai = agent({ protocol: "openai", config: { model: "gpt-4o" } });
    reportAgentUse(openai, session("s9"), "ru");
    expect(calls()).toContain("chat/plain");
    const first = calls().length;
    reportAgentUse(openai, session("s9"), "ru");
    expect(calls()).toHaveLength(first);
  });
});
