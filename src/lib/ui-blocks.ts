/**
 * Разбор UI-блока из текста сообщения.
 *
 * Вход — сырой `content` сообщения. Выход — `UiParts`: текст без блока
 * и блок, если он валиден. Ни одна функция не бросает исключений: битый
 * блок обязан превращаться в обычный текст, а не ломать ленту.
 *
 * `content` в IndexedDB не меняется: разбор делается на выдаче (рендер,
 * копирование, TTS, экспорт), и историю агенту тоже чистим здесь.
 */
import {
  KNOWN_PLUGINS,
  MAX_ACTIONS,
  MAX_BADGES,
  MAX_BLOCK_BYTES,
  MAX_GROUPS,
  MAX_ITEMS,
  MAX_META,
  MAX_SEND,
  MAX_STRING,
  MAX_TITLE,
  UI_FENCE,
  UI_SCHEMA_VERSION,
  type ActionScope,
  type ActionStyle,
  type Optimistic,
  type UiAction,
  type UiBlock,
  type UiData,
  type UiGroup,
  type UiIssue,
  type UiItem,
  type UiMeta,
  type UiParts,
  type UiView,
} from "@/plugins/types";

const FENCE_OPEN = "```" + UI_FENCE;
const FENCE_CLOSE = "```";

const VIEWS: ReadonlySet<string> = new Set(["list", "table", "board", "card", "markdown"]);
const SCOPES: ReadonlySet<string> = new Set(["item", "view"]);
const STYLES: ReadonlySet<string> = new Set(["primary", "ghost", "danger"]);
const OPTIMISTIC: ReadonlySet<string> = new Set(["remove", "check", "disable"]);
const PLUGIN_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/i;

export type ParseResult =
  | { ok: true; block: UiBlock }
  | { ok: false; code: Extract<UiIssue["code"], "bad-json" | "bad-shape" | "bad-version" | "unknown-plugin" | "too-large">; detail?: string };

interface RawFence {
  raw: string;
  start: number;
  end: number;
  /** Ограждение закрывается в самом конце сообщения (дальше только пробелы). */
  atEnd: boolean;
}

function byteLength(text: string): number {
  try {
    return new TextEncoder().encode(text).length;
  } catch {
    return text.length * 2;
  }
}

function str(value: unknown, max = MAX_STRING): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function rawString(value: unknown, max = MAX_STRING): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return undefined;
  return text.length > max ? text.slice(0, max) : text;
}

function safeUrl(value: unknown): string | undefined {
  const url = rawString(value, MAX_STRING);
  if (!url) return undefined;
  return /^https?:\/\/\S+$/i.test(url) ? url : undefined;
}

/** Ищем все ограждения `gena-ui`; незакрытое — повод вообще не трогать текст. */
function scanFences(content: string): RawFence[] {
  const fences: RawFence[] = [];
  const open = new RegExp(FENCE_OPEN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[ \\t]*\\r?\\n", "g");
  let match: RegExpExecArray | null;
  while ((match = open.exec(content)) !== null) {
    const bodyStart = match.index + match[0].length;
    const close = content.indexOf("\n" + FENCE_CLOSE, bodyStart);
    if (close === -1) break;
    const end = close + 1 + FENCE_CLOSE.length;
    fences.push({
      raw: content.slice(bodyStart, close),
      start: match.index,
      end,
      atEnd: content.slice(end).trim() === "",
    });
    open.lastIndex = end;
  }
  return fences;
}

function normalizeMeta(value: unknown): UiMeta[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: UiMeta[] = [];
  for (const entry of value.slice(0, MAX_META)) {
    if (!entry || typeof entry !== "object") continue;
    const src = entry as Record<string, unknown>;
    const label = str(src.label, 60);
    const val = str(src.value, 120);
    if (label && val) out.push({ label, value: val });
  }
  return out.length ? out : undefined;
}

function normalizeItem(value: unknown): UiItem | null {
  if (!value || typeof value !== "object") return null;
  const src = value as Record<string, unknown>;
  const title = str(src.title, MAX_TITLE);
  if (!title) return null;
  const item: UiItem = { id: str(src.id, 80) ?? title, title };
  const subtitle = str(src.subtitle, 200);
  if (subtitle) item.subtitle = subtitle;
  const status = str(src.status, 40);
  if (status) item.status = status;
  const due = str(src.due, 40);
  if (due) item.due = due;
  if (Array.isArray(src.badges)) {
    const badges = src.badges.map((b) => str(b, 40)).filter((b): b is string => Boolean(b)).slice(0, MAX_BADGES);
    if (badges.length) item.badges = badges;
  }
  const meta = normalizeMeta(src.meta);
  if (meta) item.meta = meta;
  if (typeof src.checked === "boolean") item.checked = src.checked;
  if (typeof src.disabled === "boolean") item.disabled = src.disabled;
  const url = safeUrl(src.url);
  if (url) item.url = url;
  return item;
}

function normalizeItems(value: unknown, limit = MAX_ITEMS): UiItem[] {
  if (!Array.isArray(value)) return [];
  const out: UiItem[] = [];
  for (const entry of value) {
    if (out.length >= limit) break;
    const item = normalizeItem(entry);
    if (item) out.push(item);
  }
  return out;
}

function normalizeGroups(value: unknown): UiGroup[] {
  if (!Array.isArray(value)) return [];
  const out: UiGroup[] = [];
  for (const entry of value.slice(0, MAX_GROUPS)) {
    if (!entry || typeof entry !== "object") continue;
    const src = entry as Record<string, unknown>;
    const key = str(src.key, 60) ?? str(src.label, 60);
    if (!key) continue;
    out.push({
      key,
      label: str(src.label, 60) ?? key,
      items: normalizeItems(src.items, MAX_ITEMS),
    });
  }
  return out;
}

function normalizeAction(value: unknown): UiAction | null {
  if (!value || typeof value !== "object") return null;
  const src = value as Record<string, unknown>;
  const id = str(src.id, 60);
  const label = str(src.label, 60);
  const send = rawString(src.send, MAX_SEND);
  const scope = str(src.scope, 10) as ActionScope | undefined;
  if (!id || !label || !send) return null;
  const action: UiAction = { id, label, scope: scope && SCOPES.has(scope) ? scope : "item", send };
  const style = str(src.style, 10) as ActionStyle | undefined;
  if (style && STYLES.has(style)) action.style = style;
  if (typeof src.confirm === "boolean") action.confirm = src.confirm;
  if (typeof src.hidden === "boolean") action.hidden = src.hidden;
  const optimistic = str(src.optimistic, 10) as Optimistic | undefined;
  if (optimistic && OPTIMISTIC.has(optimistic)) action.optimistic = optimistic;
  return action;
}

function normalizeActions(value: unknown): UiAction[] {
  if (!Array.isArray(value)) return [];
  const out: UiAction[] = [];
  for (const entry of value) {
    if (out.length >= MAX_ACTIONS) break;
    const action = normalizeAction(entry);
    if (action) out.push(action);
  }
  return out;
}

function normalizeData(value: unknown): UiData {
  const src = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const data: UiData = {};
  const view = str(src.view, 12) as UiView | undefined;
  if (view && VIEWS.has(view)) data.view = view;
  const items = normalizeItems(src.items);
  if (items.length) data.items = items;
  const groups = normalizeGroups(src.groups);
  if (groups.length) data.groups = groups;
  const markdown = rawString(src.markdown, MAX_STRING * 8);
  if (markdown) data.markdown = markdown;
  const empty = str(src.empty, 200);
  if (empty) data.empty = empty;
  return data;
}

/** Проверка уже распарсенного JSON. Неизвестный плагин — тоже отказ. */
export function validateBlock(value: unknown): ParseResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, code: "bad-shape" };
  const src = value as Record<string, unknown>;
  if (src.v !== UI_SCHEMA_VERSION) return { ok: false, code: "bad-version", detail: str(String(src.v), 20) };
  const plugin = str(src.plugin, 80);
  if (!plugin || !PLUGIN_RE.test(plugin)) return { ok: false, code: "bad-shape", detail: "plugin" };
  if (!KNOWN_PLUGINS.has(plugin)) return { ok: false, code: "unknown-plugin", detail: plugin };
  const block: UiBlock = {
    v: UI_SCHEMA_VERSION,
    plugin,
    data: normalizeData(src.data),
    actions: normalizeActions(src.actions),
  };
  const title = str(src.title, MAX_TITLE);
  if (title) block.title = title;
  return { ok: true, block };
}

/** JSON из ограждения → блок. Размер проверяем до `JSON.parse`. */
export function parseBlock(raw: string): ParseResult {
  const size = byteLength(raw);
  if (size > MAX_BLOCK_BYTES) return { ok: false, code: "too-large", detail: String(size) };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, code: "bad-json" };
  }
  return validateBlock(value);
}

/**
 * Главная функция: текст сообщения → текст без блока + блок (или null).
 *
 * Блок принимается только если он последний в сообщении. Не приняли —
 * возвращаем текст как есть, чтобы пользователь увидел всё, что прислал агент.
 */
export function splitContent(content: string): UiParts {
  const issues: UiIssue[] = [];
  if (typeof content !== "string" || !content.includes(FENCE_OPEN)) {
    return { text: typeof content === "string" ? content : "", block: null, issues };
  }
  const fences = scanFences(content);
  if (!fences.length) {
    issues.push({ code: "bad-shape", detail: "unclosed-fence" });
    return { text: content, block: null, issues };
  }
  const terminal = [...fences].reverse().find((fence) => fence.atEnd);
  if (!terminal) {
    issues.push({ code: "block-not-last" });
    return { text: content, block: null, issues };
  }
  if (fences.length > 1) issues.push({ code: "extra-blocks", detail: String(fences.length - 1) });
  const parsed = parseBlock(terminal.raw);
  if (!parsed.ok) {
    issues.push({ code: parsed.code, detail: parsed.detail });
    return { text: content, block: null, issues };
  }
  const text = `${content.slice(0, terminal.start)}${content.slice(terminal.end)}`.trimEnd();
  return { text, block: parsed.block, issues };
}

/** Обратная операция для скилла/тестов: блок → ограждение с JSON. */
export function serializeBlock(block: UiBlock): string {
  return [FENCE_OPEN, JSON.stringify(block), FENCE_CLOSE].join("\n");
}
