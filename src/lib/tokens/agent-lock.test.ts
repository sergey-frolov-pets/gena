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
