/** Слияние серверных агентов в список подключений. */

import { describe, expect, it } from "vitest";
import {
  SERVER_AGENT_PREFIX,
  mergeAgents,
  serverAgentId,
  splitServerAgentId,
} from "./server-agents";
import type { Agent } from "@/storage/types";

function agent(id: string, origin?: "server"): Agent {
  return {
    id,
    name: id,
    address: "https://x",
    sealedKey: "",
    settings: { contextSize: 10, callLimit: 0, llmModel: "" },
    ...(origin ? { origin } : {}),
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("серверные агенты", () => {
  it("id собирается и разбирается обратно, даже с двоеточием в имени агента", () => {
    const id = serverAgentId("srv-1", "ds:chat");
    expect(id).toBe(`${SERVER_AGENT_PREFIX}srv-1:ds:chat`);
    expect(splitServerAgentId(id)).toEqual({ serverId: "srv-1", agentId: "ds:chat" });
  });

  it("чужие id не разбираются", () => {
    expect(splitServerAgentId("agent-7")).toBeNull();
    expect(splitServerAgentId("srv:")).toBeNull();
    expect(splitServerAgentId("srv:only")).toBeNull();
  });

  it("локальная запись сильнее серверной с тем же id", () => {
    const merged = mergeAgents([agent("a")], [agent("a", "server"), agent("b", "server")]);
    expect(merged.map((x) => [x.id, x.origin ?? "local"])).toEqual([
      ["a", "local"],
      ["b", "server"],
    ]);
  });

  it("пустой список серверов ничего не ломает", () => {
    expect(mergeAgents([], [])).toEqual([]);
  });
});
