/**
 * Сведения о ключе и ценах, которые провайдер отдаёт по API-ключу.
 * Нет поля в ответе — в таблице пусто, цифры не подставляются из памяти.
 */

export type ProviderKind =
  | "openrouter"
  | "openai"
  | "groq"
  | "deepseek"
  | "anthropic"
  | "mistral"
  | "gemini"
  | "unknown";

export interface ProviderProfile {
  kind: ProviderKind;
  /** Страница пополнения. Пустая строка — ссылку не показываем. */
  topUpUrl: string;
}

const TOP_UP: Record<ProviderKind, string> = {
  openrouter: "https://openrouter.ai/settings/credits",
  openai: "https://platform.openai.com/settings/organization/billing/overview",
  groq: "https://console.groq.com/settings/billing",
  deepseek: "https://platform.deepseek.com/top_up",
  anthropic: "https://console.anthropic.com/settings/billing",
  mistral: "https://console.mistral.ai/billing",
  gemini: "https://aistudio.google.com/apikey",
  unknown: "",
};

export function providerProfile(address: string): ProviderProfile {
  let host = "";
  try {
    host = new URL(address).hostname.toLowerCase();
  } catch {
    host = "";
  }
  const kind: ProviderKind = host.endsWith("openrouter.ai")
    ? "openrouter"
    : host.endsWith("openai.com")
      ? "openai"
      : host.endsWith("groq.com")
        ? "groq"
        : host.endsWith("deepseek.com")
          ? "deepseek"
          : host.endsWith("anthropic.com")
            ? "anthropic"
            : host.endsWith("mistral.ai")
              ? "mistral"
              : host.endsWith("googleapis.com")
                ? "gemini"
                : "unknown";
  return { kind, topUpUrl: TOP_UP[kind] };
}

export interface AccountFacts {
  /** Остаток в деньгах, как отдал провайдер. */
  money: string;
  /** Бесплатный или квотный остаток. */
  free: string;
  /** Срок ключа, если провайдер его сообщил. */
  expiresAt: string;
}

const EMPTY: AccountFacts = { money: "", free: "", expiresAt: "" };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") return value.trim();
  return "";
}

/** Дата из ISO или unix-секунд/мс. Пусто, если разобрать нельзя. */
export function formatExpiry(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1_000_000_000_000 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
  }
  const raw = text(value);
  if (!raw) return "";
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toISOString().slice(0, 10);
}

function expiryFrom(record: Record<string, unknown> | null): string {
  if (!record) return "";
  return formatExpiry(record.expires_at ?? record.expiresAt ?? record.expiry ?? record.expires);
}

/** OpenRouter: кредиты и, если есть, срок ключа. */
export function parseOpenRouterAccount(credits: unknown, keyInfo: unknown): AccountFacts {
  const creditData = asRecord(asRecord(credits)?.data) ?? asRecord(credits);
  const keyData = asRecord(asRecord(keyInfo)?.data) ?? asRecord(keyInfo);
  let money = "";
  if (creditData) {
    const total = Number(creditData.total_credits);
    const used = Number(creditData.total_usage);
    if (Number.isFinite(total) && Number.isFinite(used)) {
      money = `${(total - used).toFixed(2)} USD`;
    }
  }
  let free = "";
  if (keyData) {
    if (keyData.is_free_tier === true) free = "free";
    const left = text(keyData.limit_remaining);
    const limit = text(keyData.limit);
    if (left && limit) free = free ? `${free}, ${left}/${limit}` : `${left}/${limit}`;
    else if (left) free = free ? `${free}, ${left}` : left;
  }
  return { money, free, expiresAt: expiryFrom(keyData) };
}

/** DeepSeek: денежный и подаренный баланс. */
export function parseDeepSeekBalance(payload: unknown): AccountFacts {
  const root = asRecord(payload);
  const infos = root?.balance_infos;
  const first = Array.isArray(infos) ? asRecord(infos[0]) : null;
  if (!first) return EMPTY;
  const currency = text(first.currency) || "USD";
  const money = text(first.total_balance);
  const granted = text(first.granted_balance);
  return {
    money: money ? `${money} ${currency}` : "",
    free: granted ? `${granted} ${currency}` : "",
    expiresAt: expiryFrom(first) || expiryFrom(root),
  };
}

/** Цена OpenRouter: USD за 1M токенов, вход / выход. */
export function formatTokenPrice(prompt: unknown, completion: unknown): string {
  const pin = Number(prompt);
  const pout = Number(completion);
  if (!Number.isFinite(pin) || !Number.isFinite(pout)) return "";
  const perM = (value: number) => (value * 1_000_000).toFixed(2);
  return `$${perM(pin)} / $${perM(pout)} per 1M`;
}

/** Карта id модели → цена из ответа `/models`. */
export function pricesFromModels(payload: unknown): Record<string, string> {
  const root = asRecord(payload);
  const list = Array.isArray(payload) ? payload : Array.isArray(root?.data) ? root.data : [];
  const out: Record<string, string> = {};
  for (const item of list) {
    const row = asRecord(item);
    if (!row) continue;
    const id = text(row.id);
    const pricing = asRecord(row.pricing);
    if (!id || !pricing) continue;
    const price = formatTokenPrice(pricing.prompt, pricing.completion);
    if (price) out[id] = price;
  }
  return out;
}

function endpoint(address: string, path: string): string | null {
  try {
    const url = new URL(address);
    return `${url.origin}${path}`;
  } catch {
    return null;
  }
}

async function getJson(url: string, apiKey: string, headers: Record<string, string> = {}): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, ...headers },
  });
  if (!response.ok) {
    throw new Error(String(response.status));
  }
  return response.json();
}

/** Запросить баланс и срок ключа. Неизвестный провайдер — пустые поля, без запроса. */
export async function fetchAccount(address: string, apiKey: string): Promise<AccountFacts> {
  const { kind } = providerProfile(address);
  if (!apiKey || kind === "unknown" || kind === "openai" || kind === "groq" || kind === "anthropic" || kind === "mistral" || kind === "gemini") {
    return EMPTY;
  }
  if (kind === "openrouter") {
    const creditsUrl = endpoint(address, "/api/v1/credits");
    const keyUrl = endpoint(address, "/api/v1/key");
    if (!creditsUrl || !keyUrl) return EMPTY;
    const [credits, keyInfo] = await Promise.all([
      getJson(creditsUrl, apiKey).catch(() => null),
      getJson(keyUrl, apiKey).catch(() => null),
    ]);
    return parseOpenRouterAccount(credits, keyInfo);
  }
  const balanceUrl = endpoint(address, "/user/balance");
  if (!balanceUrl) return EMPTY;
  return parseDeepSeekBalance(await getJson(balanceUrl, apiKey));
}

/** Идентификаторы из OpenAI-совместимого `/models`. */
export function modelIdsFromPayload(payload: unknown): string[] {
  const root = asRecord(payload);
  const list = Array.isArray(payload) ? payload : Array.isArray(root?.data) ? root.data : [];
  const ids: string[] = [];
  for (const item of list) {
    const row = asRecord(item);
    const id = row ? text(row.id) : "";
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Цены моделей с OpenAI-совместимого `/models`. Пустая карта, если цен нет. */
export async function fetchModelPrices(address: string, apiKey: string): Promise<Record<string, string>> {
  const root = address.replace(/\/+$/, "");
  if (!root || !apiKey) return {};
  try {
    return pricesFromModels(await getJson(`${root}/models`, apiKey));
  } catch {
    return {};
  }
}

/** Список моделей провайдера. Бросает ошибку, если ключ или адрес не приняты. */
export async function fetchModelIds(address: string, apiKey: string): Promise<string[]> {
  const root = address.replace(/\/+$/, "");
  if (!root || !apiKey) return [];
  return modelIdsFromPayload(await getJson(`${root}/models`, apiKey));
}

const STORAGE_KEY = "gena.accountSnapshots";

export interface AccountSnapshot extends AccountFacts {
  agentId: string;
  fetchedAt: number;
}

export function readSnapshots(): Record<string, AccountSnapshot> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as Record<string, AccountSnapshot>;
  } catch {
    return {};
  }
}

export function writeSnapshot(snapshot: AccountSnapshot): void {
  const all = readSnapshots();
  all[snapshot.agentId] = snapshot;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}
