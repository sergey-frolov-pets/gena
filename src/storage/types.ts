/**
 * Доменные типы Gena.
 *
 * Agent — подключение к агенту (аналог «сервера» у мессенджера):
 *   адрес + ключ (хранится зашифрованным) + настройки чата.
 * Session — диалог с агентом. Message — сообщение в сессии.
 */

import type { MorphLemmaEntry } from "@/lib/tokens/morph/format";

export interface AgentSettings {
  /** Сколько последних сообщений отправлять агенту как контекст. */
  contextSize: number;
  /** Лимит вызовов агента в сутки. 0 — без лимита. */
  callLimit: number;
  /** Идентификатор LLM-модели на стороне агента. */
  llmModel: string;
  /** Стандартные сообщения: кнопки над композером, отправляются одним тапом. */
  quickReplies?: string[];
}

/** Протокол подключения к агенту. Нет поля `protocol` у старого агента → `http_json`. */
export type Protocol = "http_json" | "openai" | "pico_ws" | "model_pool" | "model_mix";

/** Модель в пуле одного провайдера. `dailyLimit` 0 — без дневного лимита. */
export interface PoolModel {
  id: string;
  free?: boolean;
  dailyLimit?: number;
}

/** Пул моделей одного провайдера: общий ключ и адрес, очередь при лимите. */
export interface ModelPoolConfig {
  models: PoolModel[];
  /** Бесплатные модели с живым дневным лимитом идут раньше остальных. */
  preferFree?: boolean;
  systemPrompt?: string;
}

/** Ссылка на модель уже сохранённого провайдера (OpenAI или пул). */
export interface MixRoute {
  agentId: string;
  model: string;
}

/** Сводка: модели разных провайдеров в заданном порядке, ключи остаются у них. */
export interface ModelMixConfig {
  routes: MixRoute[];
  preferFree?: boolean;
}

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

export type AgentConfig =
  | OpenAIConfig
  | PicoConfig
  | HttpJsonConfig
  | ModelPoolConfig
  | ModelMixConfig;

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
  /**
   * «Только режим токенов»: диалоги этого агента всегда защищённые,
   * снять защиту из чата нельзя — только здесь, в подключении.
   */
  tokenOnly?: boolean;
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
  /** Закреплённый диалог поднимается в начало списка. */
  pinned?: boolean;
  /**
   * Теги диалога: свободные метки для фильтра («работа», «вклады»).
   * Хранятся в самой записи сессии, поэтому попадают и в бэкап.
   */
  tags?: string[];
  /**
   * Диалог явно переведён в режим токенов: в истории хранятся токены
   * `⟦имя⟧`, а не значения справочника. Ставится человеком, не автоматически.
   */
  tokenMode?: boolean;
  /**
   * Как показывать ленту этого диалога: отсутствие поля — значения (по умолчанию),
   * `"tokens"` — токены. Решение хранится на диалог, а не глобально.
   */
  tokenView?: "tokens";
  /**
   * Человек один раз подтвердил в этом диалоге, что агенту уходят только токены.
   * Дальше отправка идёт без повторного вопроса.
   */
  tokenSendAck?: boolean;
  /**
   * Имена токенов только этого диалога: `name` видно в тексте, `source` —
   * запись справочника. Справочник не переименовывается.
   */
  tokenAliases?: { name: string; source: string }[];
}

/**
 * Запись справочника подстановок.
 *
 * Имя видно в чате (внутри токена `⟦имя⟧`), значение хранится зашифрованным
 * ключом устройства — на диск в открытом виде не попадает.
 */
export interface TokenRecord {
  id: string;
  /** Отображаемое имя токена (уникально без учёта регистра). */
  name: string;
  /** Ключ уникальности: имя, приведённое к нижнему регистру. */
  nameKey: string;
  /** Запечатанное значение (`enc:tk1:<iv>.<cipher>`). */
  sealedValue: string;
  /** Пояснение для человека (не секрет). */
  note?: string;
  /** Дополнительные написания: падежи, сокращения, другой порядок слов. */
  variants?: string[];
  /** Искать значение с учётом регистра (по умолчанию регистр не важен). */
  caseSensitive?: boolean;
  /**
   * Сессия, в которой токен создан. Значение подсвечивается только в ней,
   * пока запись не помечена общей.
   */
  sessionId?: string;
  /**
   * Общий токен: значение можно подсвечивать в любом диалоге.
   * Нет поля и нет `sessionId` — старая запись справочника, она тоже общая.
   */
  shared?: boolean;
  createdAt: number;
  updatedAt: number;
}

export type MessageRole = "user" | "assistant" | "system";

/** Вложение сообщения. В историю кладём только миниатюру, не оригинал. */
export interface MessageAttachment {
  /** `image` — картинка, `file` — документ (в агенте он уже как текст). */
  kind: "image" | "file";
  /** data-URL миниатюры (≤ 200 px) — только у изображений. */
  thumb?: string;
  width?: number;
  height?: number;
  /** Имя файла-документа (только для `file`). */
  name?: string;
  /** Размер файла в байтах (только для `file`). */
  bytes?: number;
  /**
   * Путь на сервере (`/pico/media/<ref>`) для входящих изображений —
   * полный размер догружается авторизованным `fetch` при просмотре.
   */
  refUrl?: string;
}

/** Тип сообщения: мысли и вызовы инструментов в контекст модели НЕ попадают. */
export type MessageKind = "text" | "thought" | "tool_calls";

export interface Message {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  createdAt: number;
  /** Сколько шёл ответ: от отправки реплики до этого сообщения (мс). */
  elapsedMs?: number;
  /** Тип сообщения. Нет поля → обычное текстовое. */
  kind?: MessageKind;
  /** Идентификатор сообщения на стороне сервера (для `message.update`). */
  serverId?: string;
  /** Имя модели, сгенерировавшей сообщение (если сервер сообщил). */
  model?: string;
  /** Агент, который написал этот ответ. Нет поля — агент сессии на тот момент. */
  responderId?: string;
  /** Расход токенов за ход (если сервер сообщил). */
  usage?: unknown;
  /** Вложения (только изображения — их принимает сервер Pico). */
  attachments?: MessageAttachment[];
  /** Когда сообщение отредактировано (мс). */
  editedAt?: number;
  /** Прежние редакции текста, от старой к новой. */
  edits?: string[];
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

/**
 * Привести число из формы к целому ≥ 0.
 * Пустая строка, мусор и `NaN` → 0; дробное округляется.
 */
export function toCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  contextSize: 20,
  callLimit: 0,
  llmModel: "",
  quickReplies: [],
};

/** Сколько стандартных сообщений хранить у агента. */
export const MAX_QUICK_REPLIES = 12;
/** Предельная длина одного стандартного сообщения. */
export const QUICK_REPLY_MAX_LEN = 200;

/**
 * Стандартные сообщения агента: одна строка — одна кнопка.
 * Принимает и массив, и текст из формы; пустые строки, дубли и хвосты отбрасываются.
 */
export function normalizeQuickReplies(input: unknown): string[] {
  const list = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split("\n")
      : [];
  const out: string[] = [];
  for (const item of list) {
    const text = String(item ?? "")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim()
      .slice(0, QUICK_REPLY_MAX_LEN);
    if (!text || out.includes(text)) continue;
    out.push(text);
    if (out.length >= MAX_QUICK_REPLIES) break;
  }
  return out;
}

/** Версия схемы для новых (мульти-протокольных) агентов. */
export const SCHEMA_VERSION = 2;

/**
 * Привести агента к каноничной форме. Идемпотентно: повторный вызов не меняет результат.
 * Старые агенты (без protocol/config) читаются как `http_json` c пустым `config`.
 */
export function normalizeAgent(raw: Agent): Agent {
  return {
    ...raw,
    settings: {
      ...raw.settings,
      quickReplies: normalizeQuickReplies(raw.settings?.quickReplies),
    },
    protocol: raw.protocol ?? "http_json",
    config: raw.config ?? {},
    schemaVersion: raw.schemaVersion ?? (raw.protocol ? SCHEMA_VERSION : 1),
  };
}

/**
 * Скачанный морфологический словарь (стор `morph`).
 *
 * Хранится целиком одним объектом: парадигмы падежей по леммам. Файл
 * скачивается один раз и дальше читается с устройства — сеть нужна только
 * для обновления.
 */
export interface MorphRecord {
  /** Постоянный ключ записи: сейчас всегда `ru`. */
  id: string;
  /** Версия формата файла (совпадает с `MORPH_VERSION`). */
  version: number;
  /** Когда файл был собран генератором. */
  createdAt?: string;
  source?: string;
  license?: string;
  /** Порядок падежей — часть формата. */
  cases: string[];
  /** Парадигмы: лемма → формы падежей. */
  lemmas: Record<string, MorphLemmaEntry>;
  /** Размер файла в байтах (для отчёта в интерфейсе). */
  bytes: number;
  /** Когда словарь попал на устройство. */
  downloadedAt: number;
}
