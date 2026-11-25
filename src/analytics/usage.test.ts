import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, Session } from "@/storage/types";
import { trackEvent } from "./goatcounter";
import {
  agentEvents,
  agentTypeOf,
  analyticsSlug,
  connectionPathOf,
  emptyUsageState,
  modelsOf,
  providerOf,
  reportAgentUse,
  reportAppVisit,
  reportPage,
  reportClick,
  reportSiteClick,
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
    expect(events).toEqual(["language/ru", "chat/simple"]);
  });

  it("провайдер узнаётся по адресу, адрес в отчёт не уходит", () => {
    expect(providerOf(agent({ address: "https://openrouter.ai/api/v1" }))).toBe("openrouter");
    expect(providerOf(agent({ address: "https://api.deepseek.com/v1" }))).toBe("deepseek");
    expect(providerOf(agent({ address: "https://api.moonshot.ai/v1" }))).toBe("moonshot");
    expect(providerOf(agent({ address: "https://example.org/v1" }))).toBe("custom");
  });
});

describe("путь подключения", () => {
  it("HTTP-подключение — провайдер и модель", () => {
    const path = connectionPathOf(
      agent({ protocol: "openai", address: "https://openrouter.ai/api/v1", config: { model: "deepseek-flash" } }),
    );
    expect(path).toEqual({
      kind: "provider",
      first: "openrouter",
      second: "deepseek-flash",
      path: "provider/openrouter/deepseek-flash",
    });
  });

  it("WebSocket-подключение — протокол и агент", () => {
    const path = connectionPathOf(agent({ protocol: "pico_ws", address: "ws://127.0.0.1:18790" }));
    expect(path).toEqual({
      kind: "protocol",
      first: "pico_ws",
      second: "picoclaw",
      path: "protocol/pico_ws/picoclaw",
    });
  });

  it("модель из ответа точнее настройки, служебное «default» игнорируется", () => {
    const openai = agent({ protocol: "openai", address: "https://openrouter.ai/api/v1", config: { model: "gpt-4o" } });
    expect(connectionPathOf(openai, "ds-pro").path).toBe("provider/openrouter/ds-pro");
    expect(connectionPathOf(openai, "default").path).toBe("provider/openrouter/gpt-4o");
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
    expect(agentTypeOf(agent({ protocol: "openai", config: { model: "x" }, address: "http://box.example:8642/v1" }))).toBe(
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
  it("HTTP: язык, модель, провайдер/модель, чат", () => {
    const openai = agent({ protocol: "openai", address: "https://openrouter.ai/api/v1", config: { model: "gpt-4o" } });
    const { events, state } = agentEvents(openai, session("s1"), "ru", empty, "2026-11-24");
    expect(events).toEqual([
      "language/ru",
      "model/gpt-4o",
      "provider/openrouter/gpt-4o",
      "chat/simple",
    ]);
    expect(state).toEqual({
      day: "2026-11-24",
      models: ["gpt-4o"],
      pairs: ["provider/openrouter/gpt-4o"],
      chats: ["s1|plain"],
    });
    expect(events.join(" ")).not.toContain("личный");
    expect(events.join(" ")).not.toContain("secret");
    expect(events.join(" ")).not.toContain("Секретное");
  });

  it("WebSocket: язык, протокол/агент, чат", () => {
    const pico = agent({ protocol: "pico_ws", address: "ws://127.0.0.1:18790", settings: { contextSize: 8, callLimit: 0, llmModel: "deepseek-flash" } });
    const { events } = agentEvents(pico, session("s1"), "ru", empty, "2026-11-24");
    expect(events).toEqual(["language/ru", "protocol/pico_ws/picoclaw", "chat/simple"]);
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
    expect(second.events).toEqual(["chat/protected"]);
    expect(second.state.chats).toEqual(["s1|plain", "s2|token"]);
  });

  it("смена режима в том же диалоге — второй чат, а не тот же", () => {
    const openai = agent({ protocol: "openai", config: { model: "gpt-4o" } });
    const plain = agentEvents(openai, session("s1"), "ru", empty, "2026-11-24");
    const token = agentEvents(openai, session("s1", true), "ru", plain.state, "2026-11-24");
    expect(token.events).toEqual(["chat/protected"]);
    expect(token.state.chats).toEqual(["s1|plain", "s1|token"]);
    const back = agentEvents(openai, session("s1"), "ru", token.state, "2026-11-24");
    expect(back.events).toEqual([]);
  });

  it("модель, которой ответил сервер, важнее настройки подключения", () => {
    const pico = agent({ protocol: "pico_ws", settings: { contextSize: 8, callLimit: 0, llmModel: "deepseek-flash" } });
    const { events } = agentEvents(pico, session("s1"), "ru", empty, "2026-11-24", "ds-pro");
    expect(events).toContain("protocol/pico_ws/picoclaw");
    expect(events.join(" ")).not.toContain("deepseek-flash");
  });

  it("другой агент в тот же день: новое подключение, протокол уже был", () => {
    const openai = agent({ protocol: "openai", address: "https://openrouter.ai/api/v1", config: { model: "gpt-4o" } });
    const hermes = agent({
      id: "b",
      protocol: "openai",
      address: "http://127.0.0.1:8642/v1",
      config: { model: "hermes-agent" },
    });
    const first = agentEvents(openai, session("s1"), "ru", empty, "2026-11-24");
    const second = agentEvents(hermes, session("s2"), "ru", first.state, "2026-11-24");
    expect(second.events).toEqual([
      "model/hermes-agent",
      "provider/custom/hermes-agent",
      "chat/simple",
    ]);
  });

  it("новые сутки — только язык, модели и подключения не повторяются", () => {
    const openai = agent({ protocol: "openai", config: { model: "gpt-4o" } });
    const first = agentEvents(openai, session("s1"), "ru", empty, "2026-11-24");
    const nextDay = agentEvents(openai, session("s1"), "ru", first.state, "2026-11-25");
    expect(nextDay.events).toEqual(["language/ru"]);
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
    expect(events).toContain("provider/custom/unknown");
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
      "model/gpt-4o",
      "provider/custom/gpt-4o",
      "chat/simple",
    ]);
    reportAgentUse(openai, session("s1"), "ru");
    expect(calls()).toHaveLength(4);
  });

  it("после перезагрузки страницы повтор не уходит (состояние в хранилище)", () => {
    const openai = agent({ protocol: "openai", config: { model: "gpt-4o" } });
    reportAgentUse(openai, session("s1"), "ru");
    vi.mocked(trackEvent).mockClear();
    // Новый запуск приложения: состояние читается из хранилища.
    reportAgentUse(openai, session("s1"), "ru");
    expect(calls()).toEqual([]);
    reportAgentUse(openai, session("s2"), "ru");
    expect(calls()).toEqual(["chat/simple"]);
  });

  it("смена режима в том же диалоге уходит как второй чат", () => {
    const openai = agent({ protocol: "openai", config: { model: "gpt-4o" } });
    reportAgentUse(openai, session("s1"), "ru");
    vi.mocked(trackEvent).mockClear();
    reportAgentUse(openai, session("s1", true), "ru");
    expect(calls()).toEqual(["chat/protected"]);
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
    expect(calls()).toContain("chat/simple");
    const first = calls().length;
    reportAgentUse(openai, session("s9"), "ru");
    expect(calls()).toHaveLength(first);
  });
});

describe("визит, страницы и клики", () => {
  const calls = () => vi.mocked(trackEvent).mock.calls.map(([name]) => name);

  beforeEach(() => {
    vi.mocked(trackEvent).mockClear();
    globalThis.localStorage?.clear();
    resetUsageMemory();
  });

  it("визит — один раз на открытие, язык прикладывается", () => {
    reportAppVisit("ru");
    expect(calls()).toEqual(["visit/app", "language/ru"]);
    reportAppVisit("ru");
    expect(calls()).toHaveLength(2);
  });

  it("просмотр раздела — один раз за открытие", () => {
    reportPage("connections");
    reportPage("connections");
    reportPage("about");
    expect(calls()).toEqual(["page/connections", "page/about"]);
  });

  it("клики: github, discussions, donation, license, сайты", () => {
    reportClick("github");
    reportClick("discussions");
    reportClick("donation");
    reportClick("license");
    reportSiteClick("openrouter");
    expect(calls()).toEqual([
      "click/github",
      "click/discussions",
      "click/donation",
      "click/license",
      "click/site/openrouter",
    ]);
  });

  it("пустое имя ссылки в отчёт не уходит", () => {
    reportSiteClick("   ");
    reportClick("");
    expect(calls()).toEqual([]);
  });
});
