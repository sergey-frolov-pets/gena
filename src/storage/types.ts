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

/** Протокол подключения к агенту. Нет поля `protocol` у старого агента → `http_json`. */
export type Protocol = "http_json" | "openai" | "pico_ws";

/** Настройки OpenAI-совместимого агента. */
export interface OpenAIConfig {
  model: string;
  systemPrompt?: string;
  temperature?: number;
}

/** Настройки Pico (WebSocket) агента. */
export interface PicoConfig {
  /** Автоматически переподключаться при обрыве (по умолчанию true). */
  reconnect?: boolean;
}

/** Настройки старого HTTP-JSON агента (без доп. полей). */
export interface HttpJsonConfig {
  // Поведение как у прежнего `POST {message, sessionId, settings, history}`.
}

export type AgentConfig = OpenAIConfig | PicoConfig | HttpJsonConfig;

export interface Agent {
  id: string;
  name: string;
  /** Адрес агента (URL endpoint / base URL / ws-URL). */
  address: string;
  /** Запечатанный ключ (enc:v1:...) либо пустая строка. В бэкап НЕ попадает. */
  sealedKey: string;
  settings: AgentSettings;
  /** Протокол подключения. Отсутствует у старых агентов → `http_json`. */
  protocol?: Protocol;
  /** Конфигурация, специфичная для протокола. */
  config?: AgentConfig;
  /** Версия схемы агента: 1 = legacy, 2 = мульти-протокол. */
  schemaVersion?: number;
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

/** Тип сообщения: мысли и вызовы инструментов в контекст модели НЕ попадают. */
export type MessageKind = "text" | "thought" | "tool_calls";

export interface Message {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  createdAt: number;
  /** Тип сообщения. Нет поля → обычное текстовое. */
  kind?: MessageKind;
  /** Идентификатор сообщения на стороне сервера (для `message.update`). */
  serverId?: string;
  /** Имя модели, сгенерировавшей сообщение (если сервер сообщил). */
  model?: string;
  /** Расход токенов за ход (если сервер сообщил). */
  usage?: unknown;
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

/** Версия схемы для новых (мульти-протокольных) агентов. */
export const SCHEMA_VERSION = 2;

/**
 * Привести агента к каноничной форме. Идемпотентно: повторный вызов не меняет результат.
 * Старые агенты (без protocol/config) читаются как `http_json` c пустым `config`.
 */
export function normalizeAgent(raw: Agent): Agent {
  return {
    ...raw,
    protocol: raw.protocol ?? "http_json",
    config: raw.config ?? {},
    schemaVersion: raw.schemaVersion ?? (raw.protocol ? SCHEMA_VERSION : 1),
  };
}
