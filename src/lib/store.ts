/**
 * Реактивное состояние приложения: агенты, сессии, сообщения, выбранные сессии.
 * Тонкая обёртка над storage-слоем; UI читает отсюда.
 */

import { ref } from "vue";
import type {
  Agent,
  AgentConfig,
  Message,
  MessageAttachment,
  Protocol,
  Session,
} from "@/storage/types";
import { DEFAULT_AGENT_SETTINGS, SCHEMA_VERSION } from "@/storage/types";
import {
  deleteAgent,
  deleteSession,
  getAgent,
  listAgents,
  listMessages,
  listSessions,
  putAgent,
  putMessage,
  putSession,
} from "@/storage/db";
import { openAgentKey, sealAgentKey } from "@/crypto/agent-key-cipher";
import { newId } from "@/lib/id";

export const agents = ref<Agent[]>([]);
export const sessions = ref<Session[]>([]);
export const messages = ref<Message[]>([]);
export const activeSessionId = ref<string | null>(null);
/** Отмеченные сессии для «очистить, кроме выбранных». */
export const selectedSessionIds = ref<Set<string>>(new Set());

export async function loadAgents(): Promise<void> {
  agents.value = await listAgents();
}

export async function loadSessions(): Promise<void> {
  sessions.value = await listSessions();
}

export async function loadMessages(sessionId: string): Promise<void> {
  activeSessionId.value = sessionId;
  messages.value = await listMessages(sessionId);
}

export async function createAgent(input: {
  name: string;
  address: string;
  apiKey: string;
  settings: Partial<typeof DEFAULT_AGENT_SETTINGS>;
  protocol?: Protocol;
  config?: AgentConfig;
}): Promise<Agent> {
  const id = newId("agent");
  const sealedKey = input.apiKey ? await sealAgentKey(input.apiKey, id) : "";
  const now = Date.now();
  const agent: Agent = {
    id,
    name: input.name,
    address: input.address,
    sealedKey,
    settings: { ...DEFAULT_AGENT_SETTINGS, ...input.settings },
    protocol: input.protocol ?? "http_json",
    config: input.config ?? {},
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
  };
  await putAgent(agent);
  await loadAgents();
  return agent;
}

/** Обновить ключ агента (перешифровать под тот же id). */
export async function updateAgentKey(agentId: string, apiKey: string): Promise<void> {
  const agent = await getAgent(agentId);
  if (!agent) return;
  agent.sealedKey = apiKey ? await sealAgentKey(apiKey, agentId) : "";
  agent.updatedAt = Date.now();
  await putAgent(agent);
  await loadAgents();
}

/** Обновить имя/адрес/настройки/протокол агента (ключ не трогается). */
export async function updateAgent(
  agentId: string,
  input: {
    name: string;
    address: string;
    settings: Partial<typeof DEFAULT_AGENT_SETTINGS>;
    protocol?: Protocol;
    config?: AgentConfig;
  },
): Promise<void> {
  const agent = await getAgent(agentId);
  if (!agent) return;
  agent.name = input.name;
  agent.address = input.address;
  agent.settings = { ...DEFAULT_AGENT_SETTINGS, ...input.settings };
  agent.protocol = input.protocol ?? agent.protocol ?? "http_json";
  agent.config = input.config ?? {};
  agent.schemaVersion = SCHEMA_VERSION;
  agent.updatedAt = Date.now();
  await putAgent(agent);
  await loadAgents();
}

export async function removeAgent(agentId: string): Promise<void> {
  await deleteAgent(agentId);
  await loadAgents();
}

/** Получить расшифрованный ключ агента для запроса. */
export async function getAgentKey(agent: Agent): Promise<string> {
  return openAgentKey(agent.sealedKey, agent.id);
}

export async function createSession(agentId: string, title: string): Promise<Session> {
  const now = Date.now();
  const session: Session = {
    id: newId("sess"),
    agentId,
    title: title || "Новый диалог",
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
  };
  await putSession(session);
  await loadSessions();
  return session;
}

/** Переименовать диалог. */
export async function renameSession(sessionId: string, title: string): Promise<void> {
  const session = sessions.value.find((s) => s.id === sessionId);
  if (!session) return;
  session.title = title.trim() || "Новый диалог";
  session.updatedAt = Date.now();
  await putSession(session);
  await loadSessions();
}

/** Закрепить/открепить диалог. */
export async function pinSession(sessionId: string, pinned: boolean): Promise<void> {
  const session = sessions.value.find((s) => s.id === sessionId);
  if (!session) return;
  session.pinned = pinned;
  await putSession(session);
  await loadSessions();
}

/** Дублировать диалог вместе с сообщениями. */
export async function duplicateSession(sessionId: string): Promise<Session | null> {
  const source = sessions.value.find((s) => s.id === sessionId);
  if (!source) return null;
  const now = Date.now();
  const copy: Session = {
    id: newId("sess"),
    agentId: source.agentId,
    title: `${source.title} (2)`,
    createdAt: now,
    updatedAt: now,
    messageCount: source.messageCount,
    pinned: false,
  };
  await putSession(copy);
  const sourceMessages = await listMessages(sessionId);
  for (const message of sourceMessages) {
    await putMessage({ ...message, id: newId("msg"), sessionId: copy.id });
  }
  await loadSessions();
  return copy;
}

/** Удалить диалог вместе с сообщениями. */
export async function removeSession(sessionId: string): Promise<void> {
  await deleteSession(sessionId);
  if (activeSessionId.value === sessionId) {
    activeSessionId.value = null;
    messages.value = [];
  }
  await loadSessions();
}

export async function appendMessage(
  sessionId: string,
  role: Message["role"],
  content: string,
  kind?: Message["kind"],
  attachments?: MessageAttachment[],
): Promise<Message> {
  const message: Message = {
    id: newId("msg"),
    sessionId,
    role,
    content,
    createdAt: Date.now(),
    kind,
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
  };
  await putMessage(message);

  const session = sessions.value.find((s) => s.id === sessionId);
  if (session) {
    session.messageCount += 1;
    session.updatedAt = message.createdAt;
    await putSession(session);
    await loadSessions();
  }

  if (activeSessionId.value === sessionId) {
    messages.value = [...messages.value, message];
  }
  return message;
}

export function toggleSessionSelected(id: string): void {
  const next = new Set(selectedSessionIds.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  selectedSessionIds.value = next;
}

export function clearSessionSelection(): void {
  selectedSessionIds.value = new Set();
}
