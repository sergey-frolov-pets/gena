/**
 * Регрессия: `sessions`/`messages` — реактивные прокси Vue, а IndexedDB
 * клонирует объекты структурно и падает на Proxy (DataCloneError).
 * Из-за этого «Отправить» создавал сессию, но сообщение не появлялось.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  activeSessionId,
  appendMessage,
  clearMessages,
  createSession,
  deleteMessagesFrom,
  loadMessages,
  messages,
  pinSession,
  removeMessage,
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

  it("история закрытого диалога не подставляется в открытый", async () => {
    const first = await createSession("agent-store-3", "Первый");
    await appendMessage(first.id, "user", "из первого");
    const second = await createSession("agent-store-3", "Второй");
    await appendMessage(second.id, "user", "из второго");

    // Открыли первый, тут же второй: поздний ответ на первый не должен всплыть.
    const slow = loadMessages(first.id);
    await loadMessages(second.id);
    await slow;

    expect(activeSessionId.value).toBe(second.id);
    expect(messages.value.map((m) => m.content)).toEqual(["из второго"]);
  });

  it("«Повторить ответ» в закрытом диалоге чистит хвост именно своего диалога", async () => {
    const first = await createSession("agent-store-5", "Первый");
    const question = await appendMessage(first.id, "user", "вопрос");
    await appendMessage(first.id, "assistant", "ответ");
    const second = await createSession("agent-store-5", "Второй");
    await appendMessage(second.id, "user", "другое");
    // Открыт другой диалог: `messages` держит только его сообщения.
    await loadMessages(second.id);

    await deleteMessagesFrom(first.id, question.createdAt);

    expect(await listMessages(first.id)).toEqual([]);
    expect((await listMessages(second.id)).map((m) => m.content)).toEqual(["другое"]);
  });

  it("removeMessage убирает реплику из истории и выравнивает счётчик диалога", async () => {
    const session = await createSession("agent-store-6", "Диалог");
    await loadMessages(session.id);
    await appendMessage(session.id, "user", "первая");
    const dropped = await appendMessage(session.id, "user", "вторая");

    await removeMessage(dropped);

    expect(messages.value.map((m) => m.content)).toEqual(["первая"]);
    expect((await listMessages(session.id)).map((m) => m.content)).toEqual(["первая"]);
    expect(sessions.value.find((s) => s.id === session.id)?.messageCount).toBe(1);
  });

  it("clearMessages закрывает диалог и не даёт дочитать его историю", async () => {
    const session = await createSession("agent-store-4", "Диалог");
    await appendMessage(session.id, "user", "привет");

    const pending = loadMessages(session.id);
    clearMessages();
    await pending;

    expect(activeSessionId.value).toBeNull();
    expect(messages.value).toEqual([]);
  });
});
