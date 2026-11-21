import { describe, expect, it } from "vitest";
import {
  formatExpiry,
  formatTokenPrice,
  parseDeepSeekBalance,
  parseOpenRouterAccount,
  modelIdsFromPayload,
  pricesFromModels,
  providerProfile,
} from "./provider-account";

describe("providerProfile", () => {
  it("узнаёт провайдера по хосту и даёт ссылку пополнения", () => {
    expect(providerProfile("https://openrouter.ai/api/v1").kind).toBe("openrouter");
    expect(providerProfile("https://api.deepseek.com/v1").topUpUrl).toContain("deepseek.com");
    expect(providerProfile("https://agent.example/v1").topUpUrl).toBe("");
  });
});

describe("разбор ответов провайдера", () => {
  it("OpenRouter: остаток кредитов и срок, если он есть", () => {
    const facts = parseOpenRouterAccount(
      { data: { total_credits: 10, total_usage: 1.5 } },
      { data: { limit_remaining: 20, limit: 50, expires_at: "2026-12-01T00:00:00Z" } },
    );
    expect(facts.money).toBe("8.50 USD");
    expect(facts.free).toBe("20/50");
    expect(facts.expiresAt).toBe("2026-12-01");
  });

  it("DeepSeek: деньги и подаренный баланс", () => {
    const facts = parseDeepSeekBalance({
      balance_infos: [{ currency: "USD", total_balance: "3.00", granted_balance: "1.00" }],
    });
    expect(facts.money).toBe("3.00 USD");
    expect(facts.free).toBe("1.00 USD");
  });

  it("из /models берёт id, даже если цены нет", () => {
    expect(
      modelIdsFromPayload({
        data: [{ id: "gpt-4o-mini" }, { id: "gpt-4o-mini" }, { id: "" }, { name: "skip" }],
      }),
    ).toEqual(["gpt-4o-mini"]);
  });

  it("пустой ответ не выдумывает цифры", () => {
    expect(parseDeepSeekBalance({})).toEqual({ money: "", free: "", expiresAt: "" });
    expect(formatExpiry("не дата")).toBe("не дата");
  });

  it("цена за миллион токенов и каталог моделей", () => {
    expect(formatTokenPrice("0.00000015", "0.0000006")).toBe("$0.15 / $0.60 per 1M");
    expect(
      pricesFromModels({ data: [{ id: "a/b", pricing: { prompt: "0.000001", completion: "0.000002" } }] }),
    ).toEqual({ "a/b": "$1.00 / $2.00 per 1M" });
  });
});
