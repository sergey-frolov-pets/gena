/**
 * Режим токенов диалога: включение переписывает историю значениями → токенами,
 * выключение возвращает значения обратно.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/storage/db";
import { clearTokenRecords } from "@/storage/tokens";
import { resetDeviceStore } from "@/test/device-store";
import { resetAgentKeyCipherCache } from "@/crypto/agent-key-cipher";
import { resetTokenCipherCache } from "@/crypto/token-cipher";
import {
  appendMessage,
  createSession,
  loadMessages,
  loadSessions,
  messages,
  setSessionTokenMode,
  sessions,
} from "@/lib/store";
import { loadTokens, saveToken } from "@/lib/tokens/registry";

describe("store: режим токенов", () => {
  beforeEach(async () => {
    await closeDb();
    await clearTokenRecords();
    resetDeviceStore();
    resetAgentKeyCipherCache();
    resetTokenCipherCache();
    await loadTokens();
    await loadSessions();
  });

  it("включение прячет значения, выключение возвращает", async () => {
    const session = await createSession("agent-1", "Диалог");
    await appendMessage(session.id, "user", "Открыл вклад на сумму 1 234 567 ₽");
    await appendMessage(session.id, "assistant", "Записал: 1 234 567 ₽ на год");
    await saveToken({ name: "вклад ВТБ", value: "1 234 567 ₽" });
    await loadTokens();

    const on = await setSessionTokenMode(session.id, true);
    expect(on.rewritten).toBe(2);
    await loadMessages(session.id);
    expect(messages.value.map((m) => m.content)).toEqual([
      "Открыл вклад на сумму ⟦вклад ВТБ⟧",
      "Записал: ⟦вклад ВТБ⟧ на год",
    ]);
    expect(sessions.value.find((s) => s.id === session.id)?.tokenMode).toBe(true);

    const off = await setSessionTokenMode(session.id, false);
    expect(off.rewritten).toBe(2);
    await loadMessages(session.id);
    expect(messages.value[0].content).toBe("Открыл вклад на сумму 1 234 567 ₽");
    expect(sessions.value.find((s) => s.id === session.id)?.tokenMode).toBeUndefined();
  });

  it("без изменений в тексте записи не переписываются", async () => {
    const session = await createSession("agent-1", "Пустой");
    await appendMessage(session.id, "user", "обычный текст без значений");
    const result = await setSessionTokenMode(session.id, true);
    expect(result.rewritten).toBe(0);
  });
});
