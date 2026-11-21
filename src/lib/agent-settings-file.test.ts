import { describe, expect, it } from "vitest";
import type { Agent } from "@/storage/types";
import { agentsFileFrom, parseAgentsFile, serializeAgentsJson, serializeAgentsYaml } from "./agent-settings-file";

function agent(): Agent {
  return {
    id: "a1",
    name: "Пул",
    address: "https://api.example/v1",
    sealedKey: "enc:v1:secret",
    settings: { contextSize: 12, callLimit: 0, llmModel: "", quickReplies: ["Привет"] },
    protocol: "model_pool",
    config: { models: [{ id: "mini", free: true, dailyLimit: 5 }], preferFree: true },
    createdAt: 1,
    updatedAt: 2,
  };
}

describe("файл настроек агентов", () => {
  it("JSON и YAML не содержат ключ", () => {
    const file = agentsFileFrom([agent()]);
    const json = serializeAgentsJson(file);
    const yaml = serializeAgentsYaml(file);
    expect(json).not.toContain("secret");
    expect(json).not.toContain("sealedKey");
    expect(yaml).not.toContain("secret");
    expect(yaml).toContain("mini");
    expect(parseAgentsFile(json)[0]?.name).toBe("Пул");
    expect(parseAgentsFile(yaml)[0]?.config).toEqual(file.agents[0]?.config);
  });

  it("при загрузке ключ из файла отбрасывается", () => {
    const text = JSON.stringify({
      format: "gena-agents",
      version: 1,
      agents: [{ ...agentsFileFrom([agent()]).agents[0], sealedKey: "enc:v1:nope", apiKey: "sk-live" }],
    });
    const loaded = parseAgentsFile(text);
    expect(JSON.stringify(loaded)).not.toContain("nope");
    expect(JSON.stringify(loaded)).not.toContain("sk-live");
  });

  it("принимает полный бэкап и берёт только агентов", () => {
    const text = JSON.stringify({
      format: "gena-backup",
      version: 1,
      exportedAt: 1,
      notice: "",
      agents: agentsFileFrom([agent()]).agents,
      sessions: [{ id: "s", agentId: "a1", title: "t", createdAt: 1, updatedAt: 1, messageCount: 0 }],
      messages: [],
    });
    expect(parseAgentsFile(text)).toHaveLength(1);
  });
});
