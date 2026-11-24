/**
 * События использования — в момент первого успешного запроса агенту.
 *
 * Правило: факт уходит только тогда, когда запрос реально закончился ответом
 * (упавший запрос, отмена и обрыв связи в отчёт не попадают). Одно событие —
 * один факт, повторов нет: ни после перезагрузки страницы, ни с каждым сообщением.
 *
 * Что уходит в GoatCounter (пути отчёта Events):
 *   chat/plain               — первый успешный запрос в обычном диалоге
 *   chat/token               — первый успешный запрос в защищённом диалоге
 *   protocol/<p>             — первый успешный запрос через подключение такого протокола
 *   agent/<t>                — первый успешный запрос к агенту такого типа
 *   model/<m>                — первый успешный запрос с такой моделью
 *   protocol/<p>/<m>         — первая успешная пара «протокол + модель»
 *   agent/<t>/<m>            — первая успешная пара «тип агента + модель»
 *   language/<l>             — язык интерфейса, раз в сутки
 *
 * Тип агента (agent/<t>): picoclaw, openclaw, hermes, custom. Определяется по
 * настройкам подключения, а если там ничего не сказано — по адресу: слово
 * openclaw/hermes/pico в URL или известный порт (18789 / 8642 / 18790).
 *
 * Диалог считается по режиму: если в нём сначала писали без защиты, а потом
 * включили защищённый режим (или наоборот), это два разных чата — `chat/plain`
 * и `chat/token`.
 *
 * В отчёт не попадает ничего личного: ни адреса, ни ключи, ни названия диалогов,
 * ни тексты сообщений. Модель, протокол и тип агента режутся до безопасного пути.
 */

import type { Agent, OpenAIConfig, Session } from "@/storage/types";
// Пул и сводка временно выключены — типы понадобятся, когда вернём.
// import type { ModelMixConfig, ModelPoolConfig } from "@/storage/types";
import { trackEvent } from "./goatcounter";

/** Язык интерфейса — один раз в сутки. */
const DAY_KEY = "gena.analytics.day";
/** Протоколы, по которым уже был успешный запрос. */
const PROVIDERS_KEY = "gena.analytics.providers.v2";
/** Типы агентов, по которым уже был успешный запрос. */
const AGENTS_KEY = "gena.analytics.agents.v1";
/** Модели, с которыми уже был успешный запрос. */
const MODELS_KEY = "gena.analytics.models.v2";
/** Пары «протокол + модель», по которым уже был успешный запрос. */
const PAIRS_KEY = "gena.analytics.pairs.v2";
/** Пары «тип агента + модель», по которым уже был успешный запрос. */
const AGENT_PAIRS_KEY = "gena.analytics.agent-pairs.v1";
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
  // if (protocol === "model_pool") {
  //   const models = (agent.config as ModelPoolConfig | undefined)?.models ?? [];
  //   const ids = models.map((model) => model.id.trim()).filter(Boolean);
  //   return ids.length > 0 ? ids : ["default"];
  // }
  // if (protocol === "model_mix") {
  //   const routes = (agent.config as ModelMixConfig | undefined)?.routes ?? [];
  //   const ids = routes.map((route) => route.model.trim()).filter(Boolean);
  //   return ids.length > 0 ? ids : ["default"];
  // }
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

/** Что уже отправлено: день (язык), протоколы, типы, модели, пары, диалоги. */
export interface UsageState {
  day: string;
  providers: string[];
  agents: string[];
  models: string[];
  pairs: string[];
  agentPairs: string[];
  chats: string[];
}

/** Пустое состояние — для тестов и первого запуска. */
export const emptyUsageState: UsageState = {
  day: "",
  providers: [],
  agents: [],
  models: [],
  pairs: [],
  agentPairs: [],
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
    providers: [...state.providers],
    agents: [...state.agents],
    models: [...state.models],
    pairs: [...state.pairs],
    agentPairs: [...state.agentPairs],
    chats: [...state.chats],
  };
  const events: string[] = [];
  if (state.day !== day) events.push(`language/${analyticsSlug(language)}`);

  const protocol = analyticsSlug(agent.protocol ?? "http_json");
  // Пул и сводка временно выключены (см. modelsOf): по ним не отправляем
  // ни протокол, ни тип, ни модели. Вернуть — раскомментировать modelsOf.
  const disabled = protocol === "model_pool" || protocol === "model_mix";
  const served = servedModel?.trim();
  const models = disabled ? [] : served ? [served] : modelsOf(agent);

  if (!disabled) {
    const type = analyticsSlug(agentTypeOf(agent));
    if (!next.providers.includes(protocol)) {
      events.push(`protocol/${protocol}`);
      push(next.providers, protocol);
    }
    if (!next.agents.includes(type)) {
      events.push(`agent/${type}`);
      push(next.agents, type);
    }
    const seen = new Set<string>();
    for (const model of models) {
      const slug = analyticsSlug(model);
      if (seen.has(slug)) continue;
      seen.add(slug);
      if (!next.models.includes(slug)) {
        events.push(`model/${slug}`);
        push(next.models, slug);
      }
      const pair = `${protocol}/${slug}`;
      if (!next.pairs.includes(pair)) {
        events.push(`protocol/${protocol}/${slug}`);
        push(next.pairs, pair);
      }
      const agentPair = `${type}/${slug}`;
      if (!next.agentPairs.includes(agentPair)) {
        events.push(`agent/${type}/${slug}`);
        push(next.agentPairs, agentPair);
      }
    }
  }

  if (session) {
    const key = chatKey(session);
    if (!next.chats.includes(key)) {
      events.push(session.tokenMode ? "chat/token" : "chat/plain");
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
    providers: readList(PROVIDERS_KEY, box),
    agents: readList(AGENTS_KEY, box),
    models: readList(MODELS_KEY, box),
    pairs: readList(PAIRS_KEY, box),
    agentPairs: readList(AGENT_PAIRS_KEY, box),
    chats: readList(CHATS_KEY, box),
  };
  return {
    day: stored.day > memory.day ? stored.day : memory.day,
    providers: union(stored.providers, memory.providers),
    agents: union(stored.agents, memory.agents),
    models: union(stored.models, memory.models),
    pairs: union(stored.pairs, memory.pairs),
    agentPairs: union(stored.agentPairs, memory.agentPairs),
    chats: union(stored.chats, memory.chats),
  };
}

function writeState(state: UsageState, box: Storage | null): void {
  memory.day = state.day;
  memory.providers = [...state.providers];
  memory.agents = [...state.agents];
  memory.models = [...state.models];
  memory.pairs = [...state.pairs];
  memory.agentPairs = [...state.agentPairs];
  memory.chats = [...state.chats];
  try {
    box?.setItem(DAY_KEY, state.day);
  } catch {
    // Приватный режим: день не запомнится, язык уйдёт повторно.
  }
  writeJson(PROVIDERS_KEY, state.providers, box);
  writeJson(AGENTS_KEY, state.agents, box);
  writeJson(MODELS_KEY, state.models, box);
  writeJson(PAIRS_KEY, state.pairs, box);
  writeJson(AGENT_PAIRS_KEY, state.agentPairs, box);
  writeJson(CHATS_KEY, state.chats, box);
}

/** Сбросить копию в памяти — нужно тестам, в приложении не вызывается. */
export function resetUsageMemory(): void {
  memory.day = "";
  memory.providers = [];
  memory.agents = [];
  memory.models = [];
  memory.pairs = [];
  memory.agentPairs = [];
  memory.chats = [];
}

/**
 * Успешный запрос агенту: отправить вид факта сразу.
 *
 * Вызывается после получения ответа, а не в момент отправки: упавший или
 * отменённый запрос не должен попасть в статистику. Повторный запрос в том же
 * диалоге и с теми же моделью/подключением — тишина; первый запрос в другом
 * режиме (защищённый ⇄ обычный) — новое событие `chat/plain` или `chat/token`.
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
