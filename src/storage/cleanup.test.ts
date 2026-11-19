import { beforeEach, describe, expect, it } from "vitest";
import { closeDb, putAgent, putMessage, putSession, listSessions, listMessages } from "./db";
import { clearAll, clearExcept } from "./cleanup";
import type { Agent, Message, Session } from "./types";

function makeAgent(id: string): Agent {
  return {
    id,
    name: id,
    address: "https://x",
    sealedKey: "",
    settings: { contextSize: 5, callLimit: 0, llmModel: "" },
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeSession(id: string, agentId: string): Session {
  return { id, agentId, title: id, createdAt: 1, updatedAt: 1, messageCount: 1 };
}

function makeMessage(id: string, sessionId: string): Message {
  return { id, sessionId, role: "user", content: id, createdAt: 1 };
}

async function seed(): Promise<void> {
  await putAgent(makeAgent("a1"));
  await putSession(makeSession("s1", "a1"));
  await putSession(makeSession("s2", "a1"));
  await putSession(makeSession("s3", "a1"));
  await putMessage(makeMessage("m1", "s1"));
  await putMessage(makeMessage("m2", "s2"));
  await putMessage(makeMessage("m3", "s3"));
}

describe("cleanup", () => {
  beforeEach(async () => {
    await closeDb();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase("gena");
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });

  it("clearExcept сохраняет отмеченные сессии и их сообщения", async () => {
    await seed();
    const result = await clearExcept(["s2"]);
    expect(result.removedSessions).toBe(2);
    expect(result.removedMessages).toBe(2);

    const left = await listSessions();
    expect(left.map((s) => s.id)).toEqual(["s2"]);
    const msgs = await listMessages("s2");
    expect(msgs).toHaveLength(1);
  });

  it("clearAll удаляет все сессии, но не агентов", async () => {
    await seed();
    const result = await clearAll(false);
    expect(result.removedSessions).toBe(3);
    expect(result.removedAgents).toBe(0);
    expect(await listSessions()).toHaveLength(0);
  });

  it("clearAll с removeAgents стирает и агентов", async () => {
    await seed();
    const result = await clearAll(true);
    expect(result.removedAgents).toBe(1);
  });
});
