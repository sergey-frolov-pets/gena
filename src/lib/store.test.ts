/**
 * Регрессия: `sessions`/`messages` — реактивные прокси Vue, а IndexedDB
 * клонирует объекты структурно и падает на Proxy (DataCloneError).
 * Из-за этого «Отправить» создавал сессию, но сообщение не появлялось.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  activeSessionId,
  appendMessage,
  createSession,
  loadMessages,
  messages,
  pinSession,
  renameSession,
  sessions,
} from "./store";
import { closeDb, listMessages } from "@/storage/db";

describe("store: сессия и сообщения", () => {
  beforeEach(async () => {
    await closeDb();
    sessions.value = [];
    messages.value = [];
    activeSessionId.value = null;
  });

  it("первая реплика создаёт сессию, сохраняет сообщение и обновляет updatedAt", async () => {
    const session = await createSession("agent-store-1", "Тест");
    await loadMessages(session.id);
    const message = await appendMessage(session.id, "user", "привет");

    expect(message.content).toBe("привет");
    expect(messages.value.map((m) => m.content)).toEqual(["привет"]);
    expect(await listMessages(session.id)).toHaveLength(1);

    const stored = sessions.value.find((s) => s.id === session.id);
    expect(stored?.messageCount).toBe(1);
    expect(stored?.updatedAt).toBeGreaterThanOrEqual(session.createdAt);
  });

  it("переименование и закрепление не падают на реактивном прокси", async () => {
    const session = await createSession("agent-store-2", "Старое имя");

    await renameSession(session.id, "Новое имя");
    await pinSession(session.id, true);

    const stored = sessions.value.find((s) => s.id === session.id);
    expect(stored?.title).toBe("Новое имя");
    expect(stored?.pinned).toBe(true);
  });
});
