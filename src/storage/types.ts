/**
 * Доменные типы Gena.
 *
 * Agent — подключение к агенту (аналог «сервера» у мессенджера):
 *   адрес + ключ (хранится зашифрованным) + настройки чата.
 * Session — диалог с агентом. Message — сообщение в сессии.
 */

export interface AgentSettings {
  /** Сколько последних сообщений отправлять агенту как контекст. */
  contextSize: number;
  /** Лимит вызовов агента в сутки. 0 — без лимита. */
  callLimit: number;
  /** Идентификатор LLM-модели на стороне агента. */
  llmModel: string;
}

export interface Agent {
  id: string;
  name: string;
  /** Адрес агента (URL endpoint). */
  address: string;
  /** Запечатанный ключ (enc:v1:...) либо пустая строка. В бэкап НЕ попадает. */
  sealedKey: string;
  settings: AgentSettings;
  createdAt: number;
  updatedAt: number;
}

export interface Session {
  id: string;
  agentId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Число сообщений — для списка без загрузки всех сообщений. */
  messageCount: number;
}

export type MessageRole = "user" | "assistant" | "system";

export interface Message {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  createdAt: number;
}

/**
 * Счётчик вызовов агента за календарный день (UTC).
 * Ключ в сторе `usage` — agentId. При смене дня счётчик сбрасывается.
 */
export interface UsageRecord {
  agentId: string;
  /** День в формате YYYY-MM-DD (UTC). */
  day: string;
  /** Сколько вызовов сделано в этот день. */
  count: number;
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  contextSize: 20,
  callLimit: 0,
  llmModel: "",
};
