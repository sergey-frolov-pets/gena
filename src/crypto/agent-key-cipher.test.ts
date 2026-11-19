import { beforeEach, describe, expect, it } from "vitest";
import {
  AgentKeyCipherError,
  isSealedAgentKey,
  openAgentKey,
  resetAgentKeyCipherCache,
  sealAgentKey,
} from "./agent-key-cipher";

describe("agent-key-cipher", () => {
  beforeEach(() => {
    localStorage.clear();
    resetAgentKeyCipherCache();
  });

  it("запечатывает и распечатывает ключ", async () => {
    const sealed = await sealAgentKey("super-secret-key", "agent-1");
    expect(isSealedAgentKey(sealed)).toBe(true);
    expect(sealed).not.toContain("super-secret-key");
    const opened = await openAgentKey(sealed, "agent-1");
    expect(opened).toBe("super-secret-key");
  });

  it("пустой ключ остаётся пустым", async () => {
    expect(await sealAgentKey("", "agent-1")).toBe("");
    expect(await openAgentKey("", "agent-1")).toBe("");
  });

  it("не расшифровывает ключ под чужим agentId (additionalData)", async () => {
    const sealed = await sealAgentKey("secret", "agent-1");
    await expect(openAgentKey(sealed, "agent-2")).rejects.toBeInstanceOf(AgentKeyCipherError);
  });

  it("не расшифровывает при другом device seed", async () => {
    const sealed = await sealAgentKey("secret", "agent-1");
    localStorage.clear();
    resetAgentKeyCipherCache();
    await expect(openAgentKey(sealed, "agent-1")).rejects.toBeInstanceOf(AgentKeyCipherError);
  });

  it("открытый текст (не конверт) возвращается как есть", async () => {
    expect(await openAgentKey("plain-value", "agent-1")).toBe("plain-value");
  });
});
