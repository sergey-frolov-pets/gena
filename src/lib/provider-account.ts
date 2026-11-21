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

/** DeepSeek: все валюты денежного и подаренного баланса. */
export function parseDeepSeekBalance(payload: unknown): AccountFacts {
  const root = asRecord(payload);
  const infos = Array.isArray(root?.balance_infos) ? root.balance_infos : [];
  const money: string[] = [];
  const free: string[] = [];
  let expiresAt = "";
  for (const item of infos) {
    const row = asRecord(item);
    if (!row) continue;
    const currency = text(row.currency) || "USD";
    const total = text(row.total_balance);
    const granted = text(row.granted_balance);
    if (total) money.push(`${total} ${currency}`);
    if (granted && granted !== "0" && granted !== "0.00") free.push(`${granted} ${currency}`);
    expiresAt = expiresAt || expiryFrom(row);
  }
  if (money.length === 0 && free.length === 0) return EMPTY;
  return { money: money.join(", "), free: free.join(", "), expiresAt: expiresAt || expiryFrom(root) };
}

/**
 * Цена: USD за 1M токенов, вход / выход.
 * `perMillion` — числа уже за миллион, их не умножаем.
 */
export function formatTokenPrice(prompt: unknown, completion: unknown, perMillion = false): string {
  const pin = Number(prompt);
  const pout = Number(completion);
  if (!Number.isFinite(pin) || !Number.isFinite(pout) || pin < 0 || pout < 0) return "";
  const scale = perMillion ? 1 : 1_000_000;
  const perM = (value: number) => (value * scale).toFixed(2);
  return `$${perM(pin)} / $${perM(pout)} per 1M`;
}

function priceNumbers(row: Record<string, unknown>): { prompt: unknown; completion: unknown; perMillion: boolean } | null {
  const pricing = asRecord(row.pricing);
  const prompt = pricing?.prompt ?? pricing?.input ?? row.prompt_price ?? row.input;
  const completion = pricing?.completion ?? pricing?.output ?? row.completion_price ?? row.output;
  if (prompt === undefined || completion === undefined) return null;
  const unit = text(pricing?.unit ?? row.price_unit).toLowerCase();
  const pin = Number(prompt);
  const pout = Number(completion);
  const perMillion =
    unit === "per_million" ||
    unit === "million" ||
    unit === "1m" ||
    (Number.isFinite(pin) && Number.isFinite(pout) && (pin > 0.01 || pout > 0.01));
  return { prompt, completion, perMillion };
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
    const pair = id ? priceNumbers(row) : null;
    if (!id || !pair) continue;
    const price = formatTokenPrice(pair.prompt, pair.completion, pair.perMillion);
    if (price) out[id] = price;
  }
  return out;
}

const DEEPSEEK_PRICING_URL = "https://api-docs.deepseek.com/quick_start/pricing";

/**
 * Снимок публичной таблицы DeepSeek: cache miss и output, off-peak и peak.
 * Часы пика: 01:00–04:00 и 06:00–10:00 UTC, пн–пт.
 * Страница docs не отдаёт CORS, поэтому браузер часто не может её прочитать.
 * Источник: api-docs.deepseek.com/quick_start/pricing, 20 Nov 2026.
 */
const DEEPSEEK_PEAK_HOURS = "01:00–04:00, 06:00–10:00 UTC";
const DEEPSEEK_FLASH_PRICE = `off $0.15/$0.60\npeak $0.30/$1.20\n${DEEPSEEK_PEAK_HOURS}`;
const DEEPSEEK_PRO_PRICE = `off $0.66/$1.98\npeak $1.32/$3.96\n${DEEPSEEK_PEAK_HOURS}`;

export const DEEPSEEK_PRICE_FALLBACK: Record<string, string> = {
  "deepseek-flash": DEEPSEEK_FLASH_PRICE,
  "deepseek-v4-pro": DEEPSEEK_PRO_PRICE,
  "deepseek-v4-flash": DEEPSEEK_FLASH_PRICE,
  "deepseek-v4-flash-vision-exp": DEEPSEEK_FLASH_PRICE,
};

function stripTags(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function modelSlug(cell: string): string {
  const match = cell.match(/deepseek-[a-z0-9.-]+/i);
  return match ? match[0].toLowerCase() : "";
}

function dollarCells(cells: string[]): number[] {
  const values: number[] = [];
  for (const cell of cells) {
    const match = cell.match(/^\$([0-9]+(?:\.[0-9]+)?)$/);
    if (match) values.push(Number(match[1]));
  }
  return values;
}

function bandLabel(kind: "off" | "peak", input: number | undefined, output: number | undefined): string {
  if (input === undefined || output === undefined) return "";
  if (!Number.isFinite(input) || !Number.isFinite(output)) return "";
  const usd = (value: number) => `$${value.toFixed(2)}`;
  return `${kind} ${usd(input)}/${usd(output)}`;
}

/** Часы пика из текста страницы, коротко: `peak 01:00–04:00, 06:00–10:00 UTC`. */
export function peakHoursLabel(page: string): string {
  const clocks = [...page.matchAll(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/g)].map(
    (match) => `${match[1]}–${match[2]}`,
  );
  if (clocks.length === 0) return "";
  const unique = [...new Set(clocks)];
  return `${unique.join(", ")} UTC`;
}

/** Публичная таблица DeepSeek: cache miss и output, off-peak и peak. */
export function pricesFromDeepSeekPage(page: string): Record<string, string> {
  const tables = page.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  const rows: string[][] = [];
  for (const table of tables) {
    const trs = table.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
    for (const tr of trs) {
      const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => stripTags(match[1]));
      if (cells.length > 0) rows.push(cells);
    }
  }
  const header = rows.find((cells) => cells.some((cell) => modelSlug(cell)));
  const models = header?.map(modelSlug).filter(Boolean) ?? [];
  if (models.length === 0) return {};

  const offIn: number[] = [];
  const peakIn: number[] = [];
  const offOut: number[] = [];
  const peakOut: number[] = [];
  let section = "";
  for (const cells of rows) {
    const joined = cells.join(" ").toUpperCase();
    if (joined.includes("CACHE MISS")) section = "input";
    else if (joined.includes("OUTPUT")) section = "output";
    else if (joined.includes("CACHE HIT")) section = "";
    const values = dollarCells(cells);
    if (values.length < models.length || !section) continue;
    const rates = values.slice(-models.length);
    const peak = /\bPEAK\b/.test(joined) && !joined.includes("OFF-PEAK");
    const off = joined.includes("OFF-PEAK");
    if (section === "input" && off) offIn.splice(0, offIn.length, ...rates);
    if (section === "input" && peak) peakIn.splice(0, peakIn.length, ...rates);
    if (section === "output" && off) offOut.splice(0, offOut.length, ...rates);
    if (section === "output" && peak) peakOut.splice(0, peakOut.length, ...rates);
  }

  const hours = peakHoursLabel(page);
  const out: Record<string, string> = {};
  models.forEach((id, index) => {
    const lines = [bandLabel("off", offIn[index], offOut[index]), bandLabel("peak", peakIn[index], peakOut[index])].filter(
      Boolean,
    );
    if (hours) lines.push(hours);
    if (lines.length === 0) return;
    out[id] = lines.join("\n");
  });

  const flash = models.find((id) => id.includes("flash"));
  if (flash && out[flash]) {
    const note = page.match(/legacy names([\s\S]{0,500}?)billed at the Flash/i)?.[1] ?? "";
    for (const match of note.matchAll(/<code>(deepseek-[a-z0-9.-]+)<\/code>|`(deepseek-[a-z0-9.-]+)`/gi)) {
      const id = (match[1] || match[2]).toLowerCase();
      out[id] = out[flash];
    }
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

async function deepseekCatalog(): Promise<Record<string, string>> {
  try {
    const response = await fetch(DEEPSEEK_PRICING_URL);
    if (response.ok) {
      const catalog = pricesFromDeepSeekPage(await response.text());
      if (Object.keys(catalog).length > 0) return catalog;
    }
  } catch {
    // Страница без CORS или сеть: ниже снимок.
  }
  return { ...DEEPSEEK_PRICE_FALLBACK };
}

/** Цены моделей с `/models`, а для DeepSeek — со страницы или со снимка, если API цену не отдал. */
export async function fetchModelPrices(address: string, apiKey: string): Promise<Record<string, string>> {
  const root = address.replace(/\/+$/, "");
  if (!root || !apiKey) return {};
  const kind = providerProfile(address).kind;
  try {
    const fromApi = pricesFromModels(await getJson(`${root}/models`, apiKey));
    if (Object.keys(fromApi).length > 0) return fromApi;
  } catch {
    if (kind !== "deepseek") return {};
  }
  if (kind !== "deepseek") return {};
  return deepseekCatalog();
}

/** Список моделей провайдера. Бросает ошибку, если ключ или адрес не приняты. */
export async function fetchModelIds(address: string, apiKey: string): Promise<string[]> {
  const root = address.replace(/\/+$/, "");
  if (!root || !apiKey) return [];
  return modelIdsFromPayload(await getJson(`${root}/models`, apiKey));
}

const STORAGE_KEY = "gena.accountSnapshots";
const PRICE_KEY = "gena.modelPrices";

function storedPrices(parsed: unknown): { at: number; prices: Record<string, string> } {
  if (typeof parsed !== "object" || parsed === null) return { at: 0, prices: {} };
  const record = parsed as Record<string, unknown>;
  const bag = asRecord(record.prices) ?? record;
  const prices: Record<string, string> = {};
  for (const [id, price] of Object.entries(bag)) {
    if (id === "at" || id === "prices") continue;
    if (typeof price === "string" && price) prices[id] = price;
  }
  const at = typeof record.at === "number" && Number.isFinite(record.at) ? record.at : 0;
  return { at, prices };
}

function readPriceBag(): { at: number; prices: Record<string, string> } {
  try {
    const raw = localStorage.getItem(PRICE_KEY);
    if (!raw) return { at: 0, prices: {} };
    return storedPrices(JSON.parse(raw) as unknown);
  } catch {
    return { at: 0, prices: {} };
  }
}

/** Сохранённые цены моделей: id → строка тарифа. */
export function readModelPrices(): Record<string, string> {
  return readPriceBag().prices;
}

/** Когда цены последний раз удалось записать, мс. 0 — ещё не обновляли. */
export function readModelPricesAt(): number {
  return readPriceBag().at;
}

export function writeModelPrices(more: Record<string, string>, at: number = Date.now()): void {
  if (Object.keys(more).length === 0) return;
  const prev = readPriceBag();
  localStorage.setItem(PRICE_KEY, JSON.stringify({ at, prices: { ...prev.prices, ...more } }));
}

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
