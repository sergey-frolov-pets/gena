import { describe, expect, it } from "vitest";
import type { Agent } from "@/storage/types";
import { modelSlots, orderSlots, type ModelSlot } from "./model-fallback";

function agent(partial: Partial<Agent> & Pick<Agent, "id" | "protocol">): Agent {
  return {
    name: partial.id,
    address: "https://api.test/v1",
    sealedKey: "",
    settings: { contextSize: 8, callLimit: 0, llmModel: "" },
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

function slot(partial: Partial<ModelSlot> & Pick<ModelSlot, "model" | "free">): ModelSlot {
  return {
    usageKey: partial.model,
    dailyLimit: 1,
    provider: agent({ id: "p", protocol: "openai" }),
    ...partial,
  };
}

describe("modelSlots", () => {
  it("пул отдаёт модели провайдера по порядку", () => {
    const pool = agent({
      id: "pool",
      protocol: "model_pool",
      config: {
        models: [
          { id: "free-a", free: true, dailyLimit: 5 },
          { id: " paid ", dailyLimit: 0 },
        ],
      },
    });
    const slots = modelSlots(pool, []);
    expect(slots.map((item) => item.model)).toEqual(["free-a", "paid"]);
    expect(slots[0]?.free).toBe(true);
    expect(slots[1]?.dailyLimit).toBe(0);
  });

  it("сводка берёт модели сохранённых провайдеров и пропускает чужие", () => {
    const openai = agent({
      id: "oa",
      protocol: "openai",
      settings: { contextSize: 4, callLimit: 3, llmModel: "" },
      config: { model: "gpt" },
    });
    const pool = agent({
      id: "pool",
      protocol: "model_pool",
      config: { models: [{ id: "mini", free: true, dailyLimit: 2 }] },
    });
    const mix = agent({
      id: "mix",
      protocol: "model_mix",
      config: {
        routes: [
          { agentId: "missing", model: "x" },
          { agentId: "oa", model: "gpt" },
          { agentId: "oa", model: "other" },
          { agentId: "pool", model: "mini" },
        ],
      },
    });
    const slots = modelSlots(mix, [openai, pool, mix]);
    expect(slots.map((item) => [item.model, item.free, item.dailyLimit])).toEqual([
      ["gpt", false, 3],
      ["mini", true, 2],
    ]);
    expect(slots[0]?.usageKey).toBe("oa");
  });
});

describe("orderSlots", () => {
  const slots = [
    slot({ model: "paid-1", free: false }),
    slot({ model: "free-1", free: true }),
    slot({ model: "paid-2", free: false }),
    slot({ model: "free-2", free: true }),
  ];

  it("без галочки сохраняет заданный порядок", () => {
    expect(orderSlots(slots, false, () => true).map((item) => item.model)).toEqual([
      "paid-1",
      "free-1",
      "paid-2",
      "free-2",
    ]);
  });

  it("с галочкой бесплатные идут первыми, порядок внутри групп тот же", () => {
    const open = new Set(["paid-1", "free-2", "free-1"]);
    expect(
      orderSlots(slots, true, (item) => open.has(item.model)).map((item) => item.model),
    ).toEqual(["free-1", "free-2", "paid-1"]);
  });
});
