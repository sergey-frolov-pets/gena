/**
 * Реактивное состояние приложения: агенты, сессии, сообщения, выбранные сессии.
 * Тонкая обёртка над storage-слоем; UI читает отсюда.
 */

import { ref, toRaw } from "vue";
import type {
  Agent,
  AgentConfig,
  Message,
  MessageAttachment,
  Protocol,
  Session,
} from "@/storage/types";
import { DEFAULT_AGENT_SETTINGS, SCHEMA_VERSION, toCount } from "@/storage/types";
import {
  deleteAgent,
  deleteMessage,
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

/** Настройки из формы: лимиты — целые ≥ 0, модель — без пробелов по краям. */
function normalizeSettings(input: Partial<typeof DEFAULT_AGENT_SETTINGS>) {
  const merged = { ...DEFAULT_AGENT_SETTINGS, ...input };
  return {
    contextSize: toCount(merged.contextSize),
    callLimit: toCount(merged.callLimit),
    llmModel: String(merged.llmModel ?? "").trim(),
  };
}

export const agents = ref<Agent[]>([]);
export const sessions = ref<Session[]>([]);
export const messages = ref<Message[]>([]);
export const activeSessionId = ref<string | null>(null);
/** Отмеченные сессии для «очистить, кроме выбранных». */
export const selectedSessionIds = ref<Set<string>>(new Set());
/** Сессии прочитаны из базы — можно решать, существуют ли диалоги из очереди. */
export const sessionsLoaded = ref(false);

export async function loadAgents(): Promise<void> {
  agents.value = await listAgents();
}

export async function loadSessions(): Promise<void> {
  sessions.value = await listSessions();
  sessionsLoaded.value = true;
}

/** Номер последнего запроса истории: ответ на устаревший запрос не применяем. */
let messagesRequest = 0;

export async function loadMessages(sessionId: string): Promise<void> {
  const request = (messagesRequest += 1);
  activeSessionId.value = sessionId;
  const list = await listMessages(sessionId);
  // Пока читали, открыли другой диалог — чужую историю не подставляем.
  if (request !== messagesRequest) return;
  messages.value = list;
}

/** Чистый лист: закрыть диалог и погасить незавершённые чтения истории. */
export function clearMessages(): void {
  messagesRequest += 1;
  activeSessionId.value = null;
  messages.value = [];
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
    settings: normalizeSettings(input.settings),
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
  agent.settings = normalizeSettings(input.settings);
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
  await putSession(toRaw(session));
  await loadSessions();
}

/** Закрепить/открепить диалог. */
export async function pinSession(sessionId: string, pinned: boolean): Promise<void> {
  const session = sessions.value.find((s) => s.id === sessionId);
  if (!session) return;
  session.pinned = pinned;
  await putSession(toRaw(session));
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
    clearMessages();
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
    // `sessions` хранит реактивные прокси: IndexedDB не умеет их клонировать.
    await putSession(toRaw(session));
    await loadSessions();
  }

  if (activeSessionId.value === sessionId) {
    messages.value = [...messages.value, message];
  }
  return message;
}

/**
 * Отредактировать текст сообщения, сохранив прежние версии в `edits`.
 * Возвращает обновлённое сообщение либо `null`, если текст не изменился.
 */
export async function editMessage(
  messageId: string,
  content: string,
): Promise<Message | null> {
  const message = messages.value.find((m) => m.id === messageId);
  if (!message) return null;
  const text = content.trim();
  if (!text || text === message.content) return null;
  const updated: Message = {
    ...message,
    content: text,
    edits: [...(message.edits ?? []), message.content],
    editedAt: Date.now(),
  };
  await putMessage(updated);
  messages.value = messages.value.map((m) => (m.id === messageId ? updated : m));
  return updated;
}

/**
 * Удалить сообщение и все следующие за ним в сессии.
 * Нужно для «Повторить ответ»: хвост диалога пересобирается заново.
 */
export async function deleteMessagesFrom(
  sessionId: string,
  createdAt: number,
): Promise<void> {
  // Сообщения берём из своего диалога: `messages` хранит только открытый,
  // иначе «Повторить ответ» в другом диалоге не удалил бы ничего.
  const source =
    activeSessionId.value === sessionId ? messages.value : await listMessages(sessionId);
  const doomed = source.filter(
    (m) => m.sessionId === sessionId && m.createdAt >= createdAt,
  );
  for (const message of doomed) {
    await deleteMessage(message.id);
  }

  const session = sessions.value.find((s) => s.id === sessionId);
  if (session) {
    session.messageCount = Math.max(0, session.messageCount - doomed.length);
    session.updatedAt = Date.now();
    await putSession(toRaw(session));
    await loadSessions();
  }

  if (activeSessionId.value === sessionId) {
    messages.value = messages.value.filter(
      (m) => !(m.sessionId === sessionId && m.createdAt >= createdAt),
    );
  }
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
