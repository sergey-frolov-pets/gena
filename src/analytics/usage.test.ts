import { describe, expect, it } from "vitest";
import type { Agent, Session } from "@/storage/types";
import { analyticsSlug, modelsOf, usageEvents } from "./usage";

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

function session(tokenMode?: boolean): Session {
  return {
    id: "s",
    agentId: "a",
    title: "личный диалог",
    createdAt: 0,
    updatedAt: 0,
    messageCount: 3,
    tokenMode,
  };
}

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

  it("считает обычные и защищённые диалоги и не кладёт тексты", () => {
    const events = usageEvents(
      [agent({ protocol: "openai", config: { model: "gpt-4o" }, name: "Ключ пользователя" })],
      [session(false), session(true), session(true)],
      "ru",
    );
    expect(events).toEqual([
      "locale/ru",
      "chat/plain",
      "chat/token",
      "chat/token",
      "provider/openai/gpt-4o",
    ]);
    expect(events.join(" ")).not.toContain("личный");
    expect(events.join(" ")).not.toContain("secret");
  });
});
