/**
 * Реактивное состояние приложения: агенты, сессии, сообщения, выбранные сессии.
 * Тонкая обёртка над storage-слоем; UI читает отсюда.
 */

import { ref } from "vue";
import type { Agent, Message, Session } from "@/storage/types";
import { DEFAULT_AGENT_SETTINGS } from "@/storage/types";
import {
  deleteAgent,
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

export async function appendMessage(
  sessionId: string,
  role: Message["role"],
  content: string,
): Promise<Message> {
  const message: Message = {
    id: newId("msg"),
    sessionId,
    role,
    content,
    createdAt: Date.now(),
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
