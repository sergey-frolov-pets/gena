import { describe, expect, it } from "vitest";
import { agentRequiresTokens, tokenModeLockReason } from "./agent-lock";

describe("agentRequiresTokens", () => {
  it("флаг агента включает защиту", () => {
    expect(agentRequiresTokens({ tokenOnly: true })).toBe(true);
  });

  it("без флага или без агента защиты нет", () => {
    expect(agentRequiresTokens({ tokenOnly: false })).toBe(false);
    expect(agentRequiresTokens({})).toBe(false);
    expect(agentRequiresTokens(null)).toBe(false);
    expect(agentRequiresTokens(undefined)).toBe(false);
  });
});

describe("tokenModeLockReason", () => {
  it("флаг агента важнее локальных связей", () => {
    expect(tokenModeLockReason(["вклад"], true)).toBe("agent");
    expect(tokenModeLockReason([], true)).toBe("agent");
  });

  it("без флага агента решают связи диалога", () => {
    expect(tokenModeLockReason(["вклад"], false)).toBe("links");
    expect(tokenModeLockReason([], false)).toBeNull();
  });
});

describe("agentRequiresTokens и режимы", () => {
  const trust = ["api.example.com"];

  it("trusted у доверенного провайдера не требует токенов", () => {
    expect(agentRequiresTokens({ privacy: "trusted", address: "https://api.example.com" }, trust)).toBe(false);
  });

  it("trusted вне списка доверенных тихо откатывается к токенам", () => {
    expect(agentRequiresTokens({ privacy: "trusted", address: "https://other.test" }, trust)).toBe(true);
  });

  it("auto без доверия тоже откатывается", () => {
    expect(agentRequiresTokens({ privacy: "auto", address: "https://other.test" }, trust)).toBe(true);
    expect(agentRequiresTokens({ privacy: "auto", address: "https://api.example.com" }, trust)).toBe(false);
  });

  it("старая запись без режима сохраняет прежнее поведение", () => {
    expect(agentRequiresTokens({ address: "https://other.test" }, trust)).toBe(false);
  });

  it("режим tokens требует защиту всегда", () => {
    expect(agentRequiresTokens({ privacy: "tokens", address: "https://api.example.com" }, trust)).toBe(true);
  });
});
