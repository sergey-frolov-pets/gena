import { beforeEach, describe, expect, it } from "vitest";
import {
  buildBackup,
  parseBackup,
  serializeBackup,
  BackupParseError,
  backupAgentToAgent,
  mergeAgents,
  mergeSessions,
  mergeMessages,
} from "./backup";
import type { Agent, Message, Session } from "./types";

const agent: Agent = {
  id: "agent-1",
  name: "Test",
  address: "https://x/chat",
  sealedKey: "enc:v1:AAAA.BBBB",
  settings: { contextSize: 10, callLimit: 5, llmModel: "m" },
  createdAt: 1,
  updatedAt: 2,
};

const session: Session = {
  id: "sess-1",
  agentId: "agent-1",
  title: "Диалог",
  createdAt: 1,
  updatedAt: 2,
  messageCount: 1,
};

const message: Message = {
  id: "msg-1",
  sessionId: "sess-1",
  role: "user",
  content: "привет",
  createdAt: 1,
};

describe("backup", () => {
  beforeEach(() => {});

  it("вырезает ключ агента из бэкапа", () => {
    const payload = buildBackup({ agents: [agent], sessions: [session], messages: [message] });
    const json = serializeBackup(payload);
    expect(json).not.toContain("enc:v1:AAAA.BBBB");
    expect(json).not.toContain("sealedKey");
    expect(payload.agents[0]).not.toHaveProperty("sealedKey");
  });

  it("вкладывает предупреждение о ключах и паролях", () => {
    const payload = buildBackup({ agents: [agent], sessions: [session], messages: [message] });
    expect(payload.notice).toContain("Ключи агентов и пароли");
    const json = serializeBackup(payload);
    expect(json).toContain("notice");
    expect(json).toContain("пароли");
  });

  it("восстанавливает notice при отсутствии в файле", () => {
    const payload = buildBackup({ agents: [], sessions: [], messages: [] });
    const raw = JSON.parse(serializeBackup(payload)) as Record<string, unknown>;
    delete raw.notice;
    const restored = parseBackup(JSON.stringify(raw));
    expect(restored.notice).toContain("Ключи агентов и пароли");
  });

  it("переживает roundtrip сериализации", () => {
    const payload = buildBackup({ agents: [agent], sessions: [session], messages: [message] });
    const restored = parseBackup(serializeBackup(payload));
    expect(restored.sessions).toHaveLength(1);
    expect(restored.messages[0].content).toBe("привет");
    expect(restored.agents[0].address).toBe("https://x/chat");
  });

  it("восстановленный агент имеет пустой ключ", () => {
    const payload = buildBackup({ agents: [agent], sessions: [], messages: [] });
    const restoredAgent = backupAgentToAgent(payload.agents[0]);
    expect(restoredAgent.sealedKey).toBe("");
  });

  it("отклоняет чужой формат", () => {
    expect(() => parseBackup('{"format":"other","version":1}')).toThrow(BackupParseError);
  });

  it("отклоняет битый JSON", () => {
    expect(() => parseBackup("not json")).toThrow(BackupParseError);
  });

  it("отклоняет неизвестную роль сообщения", () => {
    const payload = buildBackup({ agents: [], sessions: [], messages: [] });
    payload.messages = [{ ...message, role: "bot" as Message["role"] }];
    expect(() => parseBackup(serializeBackup(payload))).toThrow(BackupParseError);
  });
});

describe("merge-импорт", () => {
  const backupAgent = {
    id: "agent-1",
    name: "From backup",
    address: "https://y/chat",
    settings: { contextSize: 20, callLimit: 0, llmModel: "m2" },
    createdAt: 5,
    updatedAt: 6,
  };

  it("сохраняет ключ существующего агента при обновлении", () => {
    const result = mergeAgents([agent], [backupAgent]);
    expect(result.updated).toBe(1);
    expect(result.added).toBe(0);
    expect(result.toWrite[0].sealedKey).toBe("enc:v1:AAAA.BBBB");
    expect(result.toWrite[0].name).toBe("From backup");
  });

  it("добавляет нового агента с пустым ключом", () => {
    const result = mergeAgents([], [backupAgent]);
    expect(result.added).toBe(1);
    expect(result.toWrite[0].sealedKey).toBe("");
  });

  it("не затирает существующие сессии по id", () => {
    const result = mergeSessions([session], [{ ...session, title: "Другое" }]);
    expect(result.skipped).toBe(1);
    expect(result.added).toBe(0);
    expect(result.toWrite).toHaveLength(0);
  });

  it("добавляет новые сессии", () => {
    const result = mergeSessions([], [session]);
    expect(result.added).toBe(1);
    expect(result.toWrite).toHaveLength(1);
  });

  it("не затирает существующие сообщения по id", () => {
    const result = mergeMessages([message], [{ ...message, content: "иное" }]);
    expect(result.skipped).toBe(1);
    expect(result.toWrite).toHaveLength(0);
  });

  it("добавляет новые сообщения", () => {
    const result = mergeMessages([], [message]);
    expect(result.added).toBe(1);
    expect(result.toWrite[0].content).toBe("привет");
  });
});

describe("режим приватности в бэкапе", () => {
  it("privacy переезжает вместе с подключением", () => {
    const withMode: Agent = { ...agent, privacy: "auto" };
    const payload = buildBackup({ agents: [withMode], sessions: [], messages: [] });
    const parsed = parseBackup(serializeBackup(payload));
    expect(parsed.agents[0].privacy).toBe("auto");
    expect(backupAgentToAgent(parsed.agents[0]).privacy).toBe("auto");
  });

  it("старый бэкап с tokenOnly читается как режим tokens", () => {
    const payload = buildBackup({
      agents: [{ ...agent, tokenOnly: true }],
      sessions: [],
      messages: [],
    });
    const parsed = parseBackup(serializeBackup(payload));
    expect(parsed.agents[0].privacy).toBe("tokens");
    const restored = backupAgentToAgent(parsed.agents[0]);
    expect(restored.privacy).toBe("tokens");
    // normalizeAgent переписывает старый флаг в режим и само поле убирает.
    expect(restored.tokenOnly).toBeUndefined();
  });

  it("неизвестный режим — ошибка формата", () => {
    const payload = buildBackup({ agents: [agent], sessions: [], messages: [] });
    const raw = JSON.parse(serializeBackup(payload)) as { agents: Array<{ privacy?: string }> };
    raw.agents[0].privacy = "paranoid";
    expect(() => parseBackup(JSON.stringify(raw))).toThrow(BackupParseError);
  });
});
