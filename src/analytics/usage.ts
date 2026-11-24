/**
 * События использования — в момент первого запроса агенту.
 *
 * Раньше снимок уходил раз в сутки при открытии страницы: новый диалог
 * и новая модель попадали в отчёт только на следующий день. Теперь факт
 * уходит тогда, когда происходит: первый за сутки запрос к подключению
 * (провайдер + модели) и первый запрос в диалоге (обычный или защищённый).
 *
 * В GoatCounter уходит только вид факта, не содержимое: язык интерфейса,
 * протокол и модели подключения, тип диалога. Адреса, ключи, названия
 * диалогов и тексты сообщений не отправляются.
 */

import type { Agent, ModelMixConfig, ModelPoolConfig, OpenAIConfig, Session } from "@/storage/types";
import { trackEvent } from "./goatcounter";

/** Язык интерфейса — один раз в сутки. */
const DAY_KEY = "gena.analytics.day";
/** Подключения, по которым сегодня уже ушли провайдеры и модели. */
const AGENTS_KEY = "gena.analytics.agents";
/** Диалоги, которые уже посчитаны: каждый — одно событие. */
const CHATS_KEY = "gena.analytics.chats";
/** Список диалогов не должен расти бесконечно. */
const MAX_CHATS = 500;

/** Безопасный кусок пути: латиница, цифры, точка, подчёркивание, дефис. */
export function analyticsSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "unknown";
}

/** Модели, которые реально выбраны у подключения. */
export function modelsOf(agent: Agent): string[] {
  const protocol = agent.protocol ?? "http_json";
  if (protocol === "model_pool") {
    const models = (agent.config as ModelPoolConfig | undefined)?.models ?? [];
    const ids = models.map((model) => model.id.trim()).filter(Boolean);
    return ids.length > 0 ? ids : ["default"];
  }
  if (protocol === "model_mix") {
    const routes = (agent.config as ModelMixConfig | undefined)?.routes ?? [];
    const ids = routes.map((route) => route.model.trim()).filter(Boolean);
    return ids.length > 0 ? ids : ["default"];
  }
  if (protocol === "openai") {
    const model = (agent.config as OpenAIConfig | undefined)?.model?.trim() || agent.settings.llmModel.trim();
    return [model || "default"];
  }
  return [agent.settings.llmModel.trim() || "default"];
}

/** Что уже отправлено: день (язык), подключения, диалоги. */
export interface UsageState {
  day: string;
  agents: string[];
  chats: string[];
}

/**
 * Ключ учёта диалога: диалог + режим.
 *
 * Режим — свойство не диалога, а куска работы в нём: обычные запросы и
 * защищённые (режим токенов) считаются разными чатами. Диалог, в котором
 * сначала писали без защиты, а потом включили режим токенов (или наоборот),
 * даёт два события: `chat/plain` и `chat/token`.
 */
export function chatKey(session: Session): string {
  return `${session.id}|${session.tokenMode ? "token" : "plain"}`;
}

function today(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

function readList(key: string, store: Pick<Storage, "getItem"> | null): string[] {
  try {
    const raw = store?.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function readDay(store: Pick<Storage, "getItem"> | null): string {
  try {
    return store?.getItem(DAY_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeJson(key: string, value: unknown, store: Pick<Storage, "setItem"> | null): void {
  try {
    store?.setItem(key, JSON.stringify(value));
  } catch {
    // Приватный режим: событие уйдёт ещё раз при следующем запросе.
  }
}

/**
 * События одного запроса к агенту — чистая функция, чтобы проверялась без хранилища.
 *
 * Язык — раз в сутки; провайдер и модели — при первом за сутки запросе
 * к этому подключению; тип диалога — при первом запросе в этом диалоге.
 */
export function agentEvents(
  agent: Agent,
  session: Session | undefined,
  language: string,
  state: UsageState,
  day: string = today(),
): { events: string[]; state: UsageState } {
  const next: UsageState = {
    day,
    agents: state.day === day ? [...state.agents] : [],
    chats: [...state.chats],
  };
  const events: string[] = [];
  if (state.day !== day) events.push(`locale/${analyticsSlug(language)}`);
  if (!next.agents.includes(agent.id)) {
    const protocol = analyticsSlug(agent.protocol ?? "http_json");
    for (const model of modelsOf(agent)) {
      events.push(`provider/${protocol}/${analyticsSlug(model)}`);
    }
    next.agents.push(agent.id);
  }
  if (session) {
    const key = chatKey(session);
    const legacy = next.chats.indexOf(session.id);
    if (legacy >= 0) {
      // Запись из прежней версии: диалог без режима уже посчитан.
      // Обновляем ключ, чтобы смена режима дала второе событие, но не повторяем.
      next.chats[legacy] = key;
    } else if (!next.chats.includes(key)) {
      events.push(session.tokenMode ? "chat/token" : "chat/plain");
      next.chats.push(key);
      if (next.chats.length > MAX_CHATS) next.chats = next.chats.slice(-MAX_CHATS);
    }
  }
  return { events, state: next };
}

function store(): Storage | null {
  try {
    // Через globalThis: работает и в окне, и в воркере, и в тестах.
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    // Доступ к хранилищу запрещён настройками браузера.
    return null;
  }
}

/**
 * Копия состояния в памяти: приватный режим не даёт писать в хранилище,
 * и без неё провайдеры уходили бы с каждым сообщением.
 */
const memory: UsageState = { day: "", agents: [], chats: [] };

function union(first: readonly string[], second: readonly string[]): string[] {
  return [...new Set([...first, ...second])];
}

function readState(box: Storage | null): UsageState {
  const stored = {
    day: readDay(box),
    agents: readList(AGENTS_KEY, box),
    chats: readList(CHATS_KEY, box),
  };
  return {
    day: stored.day > memory.day ? stored.day : memory.day,
    agents: union(stored.agents, memory.agents),
    chats: union(stored.chats, memory.chats),
  };
}

function writeState(state: UsageState, box: Storage | null): void {
  memory.day = state.day;
  memory.agents = [...state.agents];
  memory.chats = [...state.chats];
  try {
    box?.setItem(DAY_KEY, state.day);
  } catch {
    // Приватный режим: день не запомнится, язык уйдёт повторно.
  }
  writeJson(AGENTS_KEY, state.agents, box);
  writeJson(CHATS_KEY, state.chats, box);
}

/** Сбросить копию в памяти — нужно тестам, в приложении не вызывается. */
export function resetUsageMemory(): void {
  memory.day = "";
  memory.agents = [];
  memory.chats = [];
}

/**
 * Первый запрос агенту: отправить вид факта сразу, не дожидаясь новых суток.
 * Повторные запросы в том же диалоге и к тому же подключению — тишина.
 */
export function reportAgentUse(agent: Agent, session: Session | undefined, language: string): void {
  const box = store();
  const { events, state } = agentEvents(agent, session, language, readState(box), today());
  if (events.length === 0) return;
  for (const name of events) trackEvent(name);
  writeState(state, box);
}
