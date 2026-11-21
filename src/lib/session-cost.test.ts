import { describe, expect, it } from "vitest";
import { ratesPerMillion, sessionCostLabel, tokensFromUsage } from "./session-cost";

describe("sessionCostLabel", () => {
  const prices = { "deepseek-flash": "$0.30 / $1.20 per 1M" };

  it("считает вход и выход, кэш не вычитает из входа", () => {
    expect(tokensFromUsage({ prompt_tokens: 1_000_000, completion_tokens: 500_000, cached_tokens: 100 })).toEqual({
      prompt: 1_000_000,
      completion: 500_000,
    });
    expect(ratesPerMillion("$0.30 / $1.20 per 1M")).toEqual({ input: 0.3, output: 1.2 });
    expect(
      sessionCostLabel(
        [
          { role: "user" },
          {
            role: "assistant",
            model: "deepseek-flash",
            usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 },
          },
        ],
        prices,
      ),
    ).toBe("$1.50");
  });

  it("без ставки или без токенов сумму не показывает", () => {
    expect(sessionCostLabel([{ role: "assistant", model: "other", usage: { prompt_tokens: 10, completion_tokens: 10 } }], prices)).toBe("");
    expect(sessionCostLabel([{ role: "assistant", model: "deepseek-flash" }], prices)).toBe("");
    expect(
      sessionCostLabel(
        [{ role: "assistant", usage: { prompt_tokens: 1000, completion_tokens: 0 } }],
        prices,
        "deepseek-flash",
      ),
    ).toBe("$0.0003");
  });
});
