/**
 * События использования — счётчики Gena в GoatCounter.
 *
 * Четыре вида счётчиков (пути отчёта Events):
 *
 *   visit/app            — один раз на вход в приложение (сессия вкладки),
 *                          к нему же прикладывается язык интерфейса
 *   page/<вкладка>       — просмотр раздела: page/connections, page/about,
 *                          page/sessions, page/tokens. Диалоги сюда НЕ входят:
 *                          чаты считаются отдельно (chat/simple, chat/protected)
 *   click/<куда>         — переход по внешней ссылке: click/github,
 *                          click/discussions, click/donation, click/license,
 *                          click/site/<провайдер или агент>
 *   chat/simple          — первый успешный запрос в обычном диалоге
 *   chat/protected       — первый успешный запрос в защищённом диалоге
 *   provider/<p>/<m>     — подключение по HTTP-протоколу: провайдер и модель,
 *                          например provider/openrouter/deepseek-flash
 *   protocol/<p>/<a>     — подключение по WebSocket: протокол и агент,
 *                          например protocol/pico_ws/picoclaw
 *
 * Правило «одно событие — один факт»: повторов нет ни после перезагрузки
 * страницы, ни с каждым сообщением. Счётчики провайдеров/моделей и диалогов
 * запоминаются в хранилище; визит и просмотры страниц — только в памяти
 * (это события текущего открытия приложения).
 *
 * В отчёт не попадает ничего личного: ни адреса, ни ключи, ни названия
 * диалогов, ни тексты сообщений. Модель, протокол и тип агента режутся до
 * безопасного пути.
 */

import type { Agent, OpenAIConfig, Session } from "@/storage/types";
import { trackEvent } from "./goatcounter";

/** Язык интерфейса — один раз в сутки. */
const DAY_KEY = "gena.analytics.day";
/** Модели, с которыми уже был успешный запрос. */
const MODELS_KEY = "gena.analytics.models.v2";
/** Пары «провайдер/протокол + модель/агент», которые уже посчитаны. */
const PAIRS_KEY = "gena.analytics.pairs.v2";
/** Диалоги с режимом, которые уже посчитаны: каждый — одно событие. */
const CHATS_KEY = "gena.analytics.chats.v2";
/** Списки не должны расти бесконечно. */
const MAX_ITEMS = 500;

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
  // Пул моделей и «сводка» временно выключены: такие подключения не создаются,
  // и событий по ним нет. Код оставлен закомментированным, а не удалён.
  if (protocol === "model_pool" || protocol === "model_mix") return [];
  if (protocol === "openai") {
    const model = (agent.config as OpenAIConfig | undefined)?.model?.trim() || agent.settings.llmModel.trim();
    return [model || "default"];
  }
  return [agent.settings.llmModel.trim() || "default"];
}

/** Тип агента в отчёте: узнаём по настройкам, иначе по адресу. */
export type AgentType = "picoclaw" | "openclaw" | "hermes" | "custom";

/** Подсказки по адресу: слово в URL/хосте или известный порт. */
const ADDRESS_HINTS: { type: AgentType; word: RegExp; ports: string[] }[] = [
  { type: "openclaw", word: /openclaw/, ports: ["18789"] },
  { type: "hermes", word: /hermes/, ports: ["8642"] },
  { type: "picoclaw", word: /pico(claw)?/, ports: ["18790"] },
];

/**
 * Тип агента: сначала явные признаки настроек, потом адрес.
 *
 * В отчёт уходит только тип из короткого списка, сам адрес не отправляется.
 */
export function agentTypeOf(agent: Agent): AgentType {
  if ((agent.protocol ?? "http_json") === "pico_ws") return "picoclaw";
  const model = modelsOf(agent).join(" ").toLowerCase();
  if (model.includes("openclaw")) return "openclaw";
  if (model.includes("hermes")) return "hermes";
  const address = (agent.address ?? "").toLowerCase();
  for (const hint of ADDRESS_HINTS) {
    if (hint.word.test(address)) return hint.type;
    if (hint.ports.some((port) => new RegExp(`[:/]${port}(?![0-9])`).test(address))) {
      return hint.type;
    }
  }
  return "custom";
}

/** Провайдер по адресу подключения: короткое имя, адрес в отчёт не уходит. */
export function providerOf(agent: Agent): string {
  let host = "";
  try {
    host = new URL(agent.address ?? "").hostname.toLowerCase();
  } catch {
    host = "";
  }
  const known: [string, string][] = [
    ["openrouter.ai", "openrouter"],
    ["openai.com", "openai"],
    ["groq.com", "groq"],
    ["deepseek.com", "deepseek"],
    ["anthropic.com", "anthropic"],
    ["mistral.ai", "mistral"],
    ["googleapis.com", "gemini"],
    ["moonshot.ai", "moonshot"],
  ];
  for (const [suffix, name] of known) {
    if (host.endsWith(suffix)) return name;
  }
  return "custom";
}

/**
 * Подключение в отчёте: одна строка на подключение.
 *
 * WebSocket-подключение описывается протоколом и агентом
 * (`protocol/pico_ws/picoclaw`), HTTP-подключение — провайдером и моделью
 * (`provider/openrouter/deepseek-flash`).
 */
export interface ConnectionPath {
  /** Вид счётчика: `provider` или `protocol`. */
  kind: "provider" | "protocol";
  /** Провайдер (для HTTP) или протокол (для WebSocket). */
  first: string;
  /** Модель (для HTTP) или тип агента (для WebSocket). */
  second: string;
  /** Полный путь в отчёте. */
  path: string;
}

/** Подключение в отчёте: протокол/агент для ws, провайдер/модель для HTTP. */
export function connectionPathOf(agent: Agent, servedModel?: string): ConnectionPath {
  const protocol = agent.protocol ?? "http_json";
  const rawServed = servedModel?.trim();
  // Сервер может прислать служебное «default» — это не модель, а заглушка:
  // такие значения в отчёт не пишем, берём модель из настроек подключения.
  const served = rawServed && rawServed.toLowerCase() !== "default" ? rawServed : undefined;
  if (protocol === "pico_ws") {
    const agentType = analyticsSlug(agentTypeOf(agent));
    return {
      kind: "protocol",
      first: analyticsSlug(protocol),
      second: agentType,
      path: `protocol/${analyticsSlug(protocol)}/${agentType}`,
    };
  }
  const provider = analyticsSlug(providerOf(agent));
  const model = analyticsSlug(served ?? modelsOf(agent)[0] ?? "default");
  return {
    kind: "provider",
    first: provider,
    second: model,
    path: `provider/${provider}/${model}`,
  };
}

/** Что уже отправлено: день (язык), модели, пары подключений, диалоги. */
export interface UsageState {
  day: string;
  models: string[];
  pairs: string[];
  chats: string[];
}

/** Пустое состояние — для тестов и первого запуска. */
export const emptyUsageState: UsageState = {
  day: "",
  models: [],
  pairs: [],
  chats: [],
};

/**
 * Ключ учёта диалога: диалог + режим.
 *
 * Режим — свойство не диалога, а куска работы в нём: обычные запросы и
 * защищённые (защищённый режим) считаются разными чатами.
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

/** Добавить в список новое значение, не давая списку расти бесконечно. */
function push(list: string[], value: string): void {
  if (list.includes(value)) return;
  list.push(value);
  if (list.length > MAX_ITEMS) list.splice(0, list.length - MAX_ITEMS);
}

/**
 * События одного успешного запроса к агенту — чистая функция, чтобы
 * проверялась без хранилища.
 *
 * `servedModel` — модель, которой ответил агент (если он её сообщил):
 * она точнее настройки подключения.
 */
export function agentEvents(
  agent: Agent,
  session: Session | undefined,
  language: string,
  state: UsageState,
  day: string = today(),
  servedModel?: string,
): { events: string[]; state: UsageState } {
  const next: UsageState = {
    day,
    models: [...state.models],
    pairs: [...state.pairs],
    chats: [...state.chats],
  };
  const events: string[] = [];
  if (state.day !== day) events.push(`language/${analyticsSlug(language)}`);

  const protocol = agent.protocol ?? "http_json";
  // Пул и сводка временно выключены (см. modelsOf): по ним не отправляем
  // ни провайдера, ни протокол, ни модели. Вернуть — раскомментировать modelsOf.
  const disabled = protocol === "model_pool" || protocol === "model_mix";

  if (!disabled) {
    const connection = connectionPathOf(agent, servedModel);
    const model = connection.kind === "provider" ? connection.second : undefined;
    if (model && !next.models.includes(model)) {
      events.push(`model/${model}`);
      push(next.models, model);
    }
    if (!next.pairs.includes(connection.path)) {
      events.push(connection.path);
      push(next.pairs, connection.path);
    }
  }

  if (session) {
    const key = chatKey(session);
    if (!next.chats.includes(key)) {
      events.push(session.tokenMode ? "chat/protected" : "chat/simple");
      push(next.chats, key);
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
 * и без неё одни и те же события уходили бы с каждым сообщением.
 */
const memory: UsageState = { ...emptyUsageState };

function union(first: readonly string[], second: readonly string[]): string[] {
  return [...new Set([...first, ...second])];
}

function readState(box: Storage | null): UsageState {
  const stored = {
    day: readDay(box),
    models: readList(MODELS_KEY, box),
    pairs: readList(PAIRS_KEY, box),
    chats: readList(CHATS_KEY, box),
  };
  return {
    day: stored.day > memory.day ? stored.day : memory.day,
    models: union(stored.models, memory.models),
    pairs: union(stored.pairs, memory.pairs),
    chats: union(stored.chats, memory.chats),
  };
}

function writeState(state: UsageState, box: Storage | null): void {
  memory.day = state.day;
  memory.models = [...state.models];
  memory.pairs = [...state.pairs];
  memory.chats = [...state.chats];
  try {
    box?.setItem(DAY_KEY, state.day);
  } catch {
    // Приватный режим: день не запомнится, язык уйдёт повторно.
  }
  writeJson(MODELS_KEY, state.models, box);
  writeJson(PAIRS_KEY, state.pairs, box);
  writeJson(CHATS_KEY, state.chats, box);
}

/** Сбросить копию в памяти — нужно тестам, в приложении не вызывается. */
export function resetUsageMemory(): void {
  memory.day = "";
  memory.models = [];
  memory.pairs = [];
  memory.chats = [];
  visited = false;
  pages.clear();
}

/**
 * Успешный запрос агенту: отправить вид факта сразу.
 *
 * Вызывается после получения ответа, а не в момент отправки: упавший или
 * отменённый запрос не должен попасть в статистику. Повторный запрос в том же
 * диалоге и с теми же моделью/подключением — тишина; первый запрос в другом
 * режиме (защищённый ⇄ обычный) — новое событие `chat/simple` или
 * `chat/protected`.
 */
export function reportAgentUse(
  agent: Agent,
  session: Session | undefined,
  language: string,
  servedModel?: string,
): void {
  const box = store();
  const { events, state } = agentEvents(agent, session, language, readState(box), today(), servedModel);
  if (events.length === 0) return;
  for (const name of events) trackEvent(name);
  writeState(state, box);
}

/** Визит уже посчитан в этом открытии приложения. */
let visited = false;

/**
 * Вход в приложение — один раз на сессию вкладки.
 *
 * `visit/app` уходит при первом показе приложения, язык интерфейса
 * прикладывается к нему же (раз в сутки). Повторные вызовы молчат.
 */
export function reportAppVisit(language: string): void {
  if (visited) return;
  visited = true;
  trackEvent("visit/app");
  const box = store();
  const day = today();
  if (readDay(box) !== day) {
    trackEvent(`language/${analyticsSlug(language)}`);
    try {
      box?.setItem(DAY_KEY, day);
    } catch {
      // Приватный режим: язык уйдёт повторно при следующем входе.
    }
    memory.day = day;
  }
}

/** Разделы, которые считаются просмотрами страниц. */
export type PageTab = "connections" | "sessions" | "tokens" | "balances" | "about";

/** Просмотренные за это открытие разделы: повторный переход не считается. */
const pages = new Set<string>();

/**
 * Просмотр раздела — один раз за открытие приложения на раздел.
 *
 * Диалоги (`chat`) сюда не передаются: чаты считаются отдельно, событием
 * `chat/simple` или `chat/protected`.
 */
export function reportPage(tab: PageTab): void {
  if (pages.has(tab)) return;
  pages.add(tab);
  trackEvent(`page/${tab}`);
}

/** Ссылки футера и каталога: что именно считаем кликом. */
export type ClickTarget = "github" | "discussions" | "donation" | "license";

/**
 * Переход по внешней ссылке — событие `click/<куда>`.
 *
 * Для сайтов провайдеров и агентов из каталога — `click/site/<имя>`;
 * имя режется до безопасного пути, сам адрес в отчёт не уходит.
 */
export function reportClick(target: ClickTarget | string): void {
  const slug = analyticsSlug(target);
  if (slug === "unknown") return;
  trackEvent(`click/${slug}`);
}

/** Клик по сайту провайдера или агента из каталога. */
export function reportSiteClick(name: string): void {
  const slug = analyticsSlug(name);
  if (slug === "unknown") return;
  trackEvent(`click/site/${slug}`);
}
