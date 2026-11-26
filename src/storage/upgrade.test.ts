/**
 * Обновление базы не должно терять данные.
 *
 * Регрессия: после выпуска с версией базы 4 пользователи сообщали, что
 * «после обновления пропали агенты и диалоги». Тест поднимает базу в том
 * виде, в каком её оставила версия 3, и проверяет, что после открытия
 * свежей версией записи на месте и добавились только новые сторы.
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeDb, getDb, listAgents, listSessions, listMessages } from "./db";

const DB_NAME = "gena";

function openV3(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 3);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("agents")) db.createObjectStore("agents", { keyPath: "id" });
      if (!db.objectStoreNames.contains("sessions")) {
        const store = db.createObjectStore("sessions", { keyPath: "id" });
        store.createIndex("by-agent", "agentId");
        store.createIndex("by-updated", "updatedAt");
      }
      if (!db.objectStoreNames.contains("messages")) {
        const store = db.createObjectStore("messages", { keyPath: "id" });
        store.createIndex("by-session", "sessionId");
        store.createIndex("by-session-created", ["sessionId", "createdAt"]);
      }
      if (!db.objectStoreNames.contains("usage")) db.createObjectStore("usage", { keyPath: "agentId" });
      if (!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function put(db: IDBDatabase, store: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

afterEach(async () => {
  await closeDb();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
});

describe("обновление базы 3 → 5", () => {
  it("сохраняет агентов, диалоги и сообщения", async () => {
    const old = await openV3();
    await put(old, "agents", {
      id: "agent-1",
      name: "Мой агент",
      address: "https://example.test/api",
      sealedKey: "plain-key",
      settings: { contextSize: 20, callLimit: 50, llmModel: "m", quickReplies: [] },
      protocol: "http_json",
      config: {},
      schemaVersion: 2,
      createdAt: 1,
      updatedAt: 2,
    });
    await put(old, "sessions", {
      id: "sess-1",
      agentId: "agent-1",
      title: "Диалог",
      createdAt: 1,
      updatedAt: 2,
      messageCount: 1,
    });
    await put(old, "messages", {
      id: "msg-1",
      sessionId: "sess-1",
      role: "user",
      content: "привет",
      createdAt: 3,
    });
    old.close();

    const db = await getDb();
    expect(db.version).toBe(6);
    expect(db.objectStoreNames.contains("tokens")).toBe(true);
    expect(db.objectStoreNames.contains("morph")).toBe(true);
    // v6: индексы типа и канонизации появляются на существующем сторе.
    const tokenIndexes = db.transaction("tokens", "readonly").store.indexNames;
    expect(tokenIndexes.contains("by-type")).toBe(true);
    expect(tokenIndexes.contains("by-canonical-key")).toBe(true);

    const agents = await listAgents();
    const sessions = await listSessions();
    const messages = await listMessages("sess-1");

    expect(agents.map((a) => a.id)).toEqual(["agent-1"]);
    expect(agents[0].name).toBe("Мой агент");
    expect(sessions.map((s) => s.id)).toEqual(["sess-1"]);
    expect(messages.map((m) => m.content)).toEqual(["привет"]);
  });
});
