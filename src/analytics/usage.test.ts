import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, Session } from "@/storage/types";
import { trackEvent } from "./goatcounter";
import {
  agentEvents,
  analyticsSlug,
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

const empty: UsageState = { day: "", agents: [], chats: [] };

describe("снимок статистики", () => {
  it("режет всё, кроме безопасного пути", () => {
    expect(analyticsSlug("GPT 4.1 Mini")).toBe("gpt-4.1-mini");
    expect(analyticsSlug("https://evil")).toBe("https-evil");
    expect(analyticsSlug("   ")).toBe("unknown");
  });

  it("берёт модели пула, сводки и openai, не адрес", () => {
    expect(modelsOf(agent({ protocol: "openai", config: { model: "gpt-4o-mini" } }))).toEqual([
      "gpt-4o-mini",
    ]);
    expect(
      modelsOf(agent({ protocol: "model_pool", config: { models: [{ id: "a" }, { id: "b" }] } })),
    ).toEqual(["a", "b"]);
    expect(
      modelsOf(
        agent({
          protocol: "model_mix",
          config: { routes: [{ agentId: "x", model: "claude" }] },
        }),
      ),
    ).toEqual(["claude"]);
    expect(modelsOf(agent({ protocol: "pico_ws", settings: { contextSize: 1, callLimit: 0, llmModel: "" } }))).toEqual([
      "default",
    ]);
  });

  it("первый запрос за сутки: язык, провайдер с моделями и тип диалога", () => {
    const openai = agent({ protocol: "openai", config: { model: "gpt-4o" } });
    const { events, state } = agentEvents(openai, session("s1"), "ru", empty, "2026-11-24");
    expect(events).toEqual(["locale/ru", "provider/openai/gpt-4o", "chat/plain"]);
    expect(state).toEqual({ day: "2026-11-24", agents: ["a"], chats: ["s1|plain"] });
    expect(events.join(" ")).not.toContain("личный");
    expect(events.join(" ")).not.toContain("secret");
    expect(events.join(" ")).not.toContain("Секретное");
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

  it("запись прежней версии (диалог без режима) не даёт повтора, но обновляется", () => {
    const openai = agent({ protocol: "openai", config: { model: "gpt-4o" } });
    const legacy: UsageState = { day: "2026-11-24", agents: ["a"], chats: ["s1"] };
    const same = agentEvents(openai, session("s1"), "ru", legacy, "2026-11-24");
    expect(same.events).toEqual([]);
    expect(same.state.chats).toEqual(["s1|plain"]);
    const token = agentEvents(openai, session("s1", true), "ru", same.state, "2026-11-24");
    expect(token.events).toEqual(["chat/token"]);
  });

  it("другое подключение в тот же день — свои провайдеры, без языка", () => {
    const openai = agent({ protocol: "openai", config: { model: "gpt-4o" } });
    const pool = agent({
      id: "b",
      protocol: "model_pool",
      config: { models: [{ id: "a" }, { id: "b" }] },
    });
    const first = agentEvents(openai, session("s1"), "ru", empty, "2026-11-24");
    const second = agentEvents(pool, session("s2"), "ru", first.state, "2026-11-24");
    expect(second.events).toEqual(["provider/model_pool/a", "provider/model_pool/b", "chat/plain"]);
  });

  it("новые сутки — язык и провайдеры снова, диалог не повторяется", () => {
    const openai = agent({ protocol: "openai", config: { model: "gpt-4o" } });
    const first = agentEvents(openai, session("s1"), "ru", empty, "2026-11-24");
    const nextDay = agentEvents(openai, session("s1"), "ru", first.state, "2026-11-25");
    expect(nextDay.events).toEqual(["locale/ru", "provider/openai/gpt-4o"]);
    expect(nextDay.state.chats).toEqual(["s1|plain"]);
  });

  it("кириллица в названии модели не ломает путь отчёта", () => {
    const { events } = agentEvents(
      agent({ protocol: "openai", config: { model: "Модель" } }),
      session("s1"),
      "ru",
      empty,
      "2026-11-24",
    );
    expect(events).toContain("provider/openai/unknown");
  });
});

describe("отправка в момент запроса", () => {
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
    expect(calls()).toEqual(["locale/ru", "provider/openai/gpt-4o", "chat/plain"]);
    reportAgentUse(openai, session("s1"), "ru");
    expect(calls()).toHaveLength(3);
  });

  it("после перезагрузки страницы повтор не уходит (состояние в хранилище)", () => {
    const openai = agent({ protocol: "openai", config: { model: "gpt-4o" } });
    reportAgentUse(openai, session("s1"), "ru");
    vi.mocked(trackEvent).mockClear();
    // Новый запуск приложения: те же данные, состояние читается из хранилища.
    reportAgentUse(openai, session("s1"), "ru");
    expect(calls()).toEqual([]);
    reportAgentUse(openai, session("s2"), "ru");
    expect(calls()).toEqual(["chat/plain"]);
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
    expect(calls()).toEqual(["locale/ru", "provider/openai/gpt-4o", "chat/plain"]);
    reportAgentUse(openai, session("s9"), "ru");
    expect(calls()).toHaveLength(3);
  });
});
