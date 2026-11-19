/**
 * Бэкап истории: экспорт/импорт сессий и сообщений в ОТКРЫТЫЙ JSON.
 *
 * ВАЖНО: ключи агентов (sealedKey) в бэкап НЕ попадают вообще — ни в каком виде.
 * Экспортируются только сессии, сообщения и настройки агента без секрета
 * (адрес, contextSize, callLimit, llmModel). Ключ агента пользователь
 * восстанавливает вручную после импорта.
 */

import type { Agent, AgentSettings, Message, Session } from "./types";

export const BACKUP_FORMAT = "gena-backup";
export const BACKUP_VERSION = 1;

/** Текст-предупреждение, который кладётся в каждый экспорт. */
export const BACKUP_NOTICE =
  "Открытый бэкап Gena. Ключи агентов и пароли в этот файл не включены — после импорта ключ агента нужно ввести заново.";

/** Агент в бэкапе — без sealedKey. */
export interface BackupAgent {
  id: string;
  name: string;
  address: string;
  settings: AgentSettings;
  createdAt: number;
  updatedAt: number;
}

export interface BackupPayload {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: number;
  /** Предупреждение для того, кто откроет файл: ключей и паролей тут нет. */
  notice: string;
  agents: BackupAgent[];
  sessions: Session[];
  messages: Message[];
}

export interface ExportInput {
  agents: Agent[];
  sessions: Session[];
  messages: Message[];
}

/** Убрать секрет из агента перед сериализацией. */
function toBackupAgent(agent: Agent): BackupAgent {
  return {
    id: agent.id,
    name: agent.name,
    address: agent.address,
    settings: { ...agent.settings },
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}

/** Собрать бэкап-payload. Ключи агентов вырезаются здесь. */
export function buildBackup(input: ExportInput, now: number = Date.now()): BackupPayload {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now,
    notice: BACKUP_NOTICE,
    agents: input.agents.map(toBackupAgent),
    sessions: input.sessions.map((s) => ({ ...s })),
    messages: input.messages.map((m) => ({ ...m })),
  };
}

/** Сериализовать в JSON-строку для скачивания файла. */
export function serializeBackup(payload: BackupPayload): string {
  return JSON.stringify(payload, null, 2);
}

export class BackupParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupParseError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new BackupParseError(`поле "${field}" должно быть строкой`);
  }
  return value;
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new BackupParseError(`поле "${field}" должно быть числом`);
  }
  return value;
}

function parseAgentSettings(raw: unknown): AgentSettings {
  if (!isObject(raw)) {
    throw new BackupParseError("settings агента должен быть объектом");
  }
  return {
    contextSize: asNumber(raw.contextSize, "settings.contextSize"),
    callLimit: asNumber(raw.callLimit, "settings.callLimit"),
    llmModel: asString(raw.llmModel, "settings.llmModel"),
  };
}

function parseAgent(raw: unknown): BackupAgent {
  if (!isObject(raw)) {
    throw new BackupParseError("агент должен быть объектом");
  }
  return {
    id: asString(raw.id, "agent.id"),
    name: asString(raw.name, "agent.name"),
    address: asString(raw.address, "agent.address"),
    settings: parseAgentSettings(raw.settings),
    createdAt: asNumber(raw.createdAt, "agent.createdAt"),
    updatedAt: asNumber(raw.updatedAt, "agent.updatedAt"),
  };
}

function parseSession(raw: unknown): Session {
  if (!isObject(raw)) {
    throw new BackupParseError("сессия должна быть объектом");
  }
  return {
    id: asString(raw.id, "session.id"),
    agentId: asString(raw.agentId, "session.agentId"),
    title: asString(raw.title, "session.title"),
    createdAt: asNumber(raw.createdAt, "session.createdAt"),
    updatedAt: asNumber(raw.updatedAt, "session.updatedAt"),
    messageCount: asNumber(raw.messageCount, "session.messageCount"),
  };
}

function parseMessage(raw: unknown): Message {
  if (!isObject(raw)) {
    throw new BackupParseError("сообщение должно быть объектом");
  }
  const role = asString(raw.role, "message.role");
  if (role !== "user" && role !== "assistant" && role !== "system") {
    throw new BackupParseError(`неизвестная роль сообщения: ${role}`);
  }
  return {
    id: asString(raw.id, "message.id"),
    sessionId: asString(raw.sessionId, "message.sessionId"),
    role,
    content: asString(raw.content, "message.content"),
    createdAt: asNumber(raw.createdAt, "message.createdAt"),
  };
}

/** Разобрать и провалидировать JSON-строку бэкапа. */
export function parseBackup(text: string): BackupPayload {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupParseError("файл не является корректным JSON");
  }

  if (!isObject(raw)) {
    throw new BackupParseError("корень бэкапа должен быть объектом");
  }
  if (raw.format !== BACKUP_FORMAT) {
    throw new BackupParseError(`неверный формат: ожидался "${BACKUP_FORMAT}"`);
  }
  if (raw.version !== BACKUP_VERSION) {
    throw new BackupParseError(`неподдерживаемая версия бэкапа: ${String(raw.version)}`);
  }

  if (!Array.isArray(raw.agents) || !Array.isArray(raw.sessions) || !Array.isArray(raw.messages)) {
    throw new BackupParseError("поля agents/sessions/messages должны быть массивами");
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: asNumber(raw.exportedAt, "exportedAt"),
    notice: typeof raw.notice === "string" ? raw.notice : BACKUP_NOTICE,
    agents: raw.agents.map(parseAgent),
    sessions: raw.sessions.map(parseSession),
    messages: raw.messages.map(parseMessage),
  };
}

/** Восстановить агента из бэкапа (sealedKey пустой — ключ вводят заново). */
export function backupAgentToAgent(backup: BackupAgent): Agent {
  return {
    id: backup.id,
    name: backup.name,
    address: backup.address,
    sealedKey: "",
    settings: { ...backup.settings },
    createdAt: backup.createdAt,
    updatedAt: backup.updatedAt,
  };
}
