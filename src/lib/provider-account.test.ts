import { describe, expect, it } from "vitest";
import {
  formatExpiry,
  formatTokenPrice,
  parseDeepSeekBalance,
  parseOpenRouterAccount,
  modelIdsFromPayload,
  pricesFromDeepSeekPage,
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
      balance_infos: [
        { currency: "USD", total_balance: "3.00", granted_balance: "1.00" },
        { currency: "CNY", total_balance: "12.50", granted_balance: "0.00" },
      ],
    });
    expect(facts.money).toBe("3.00 USD, 12.50 CNY");
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

  it("берёт цену из других имён полей и не умножает ставку за миллион", () => {
    expect(
      pricesFromModels({
        data: [{ id: "m", input: 0.28, output: 0.42, price_unit: "per_million" }],
      }),
    ).toEqual({ m: "$0.28 / $0.42 per 1M" });
    expect(pricesFromModels({ data: [{ id: "no-price" }] })).toEqual({});
  });

  it("разбирает таблицу DeepSeek: cache miss и output в пике", () => {
    const page = `
      <table>
        <tr><td>MODEL</td><td>deepseek-flash<sup>(1)</sup></td><td>deepseek-v4-pro</td></tr>
        <tr><td>PRICING</td><td>1M INPUT TOKENS (CACHE HIT)</td><td>OFF-PEAK</td><td>$0.003</td><td>$0.022</td></tr>
        <tr><td>PEAK</td><td>$0.006</td><td>$0.044</td></tr>
        <tr><td>1M INPUT TOKENS (CACHE MISS)</td><td>OFF-PEAK</td><td>$0.15</td><td>$0.66</td></tr>
        <tr><td>PEAK</td><td>$0.3</td><td>$1.32</td></tr>
        <tr><td>1M OUTPUT TOKENS</td><td>OFF-PEAK</td><td>$0.6</td><td>$1.98</td></tr>
        <tr><td>PEAK</td><td>$1.2</td><td>$3.96</td></tr>
      </table>
      <p>Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday.</p>
      <p>legacy names <code>deepseek-v4-flash</code> are still accepted, billed at the Flash price.</p>
    `;
    expect(pricesFromDeepSeekPage(page)).toEqual({
      "deepseek-flash": "off $0.15/$0.60 · peak $0.30/$1.20 · peak 01:00–04:00, 06:00–10:00 UTC",
      "deepseek-v4-pro": "off $0.66/$1.98 · peak $1.32/$3.96 · peak 01:00–04:00, 06:00–10:00 UTC",
      "deepseek-v4-flash": "off $0.15/$0.60 · peak $0.30/$1.20 · peak 01:00–04:00, 06:00–10:00 UTC",
    });
    expect(pricesFromDeepSeekPage("<p>нет таблицы</p>")).toEqual({});
  });
});
