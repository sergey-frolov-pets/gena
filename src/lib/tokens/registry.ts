/**
 * Справочник подстановок в памяти и на диске.
 *
 * На диск значения попадают только запечатанными ( ключ устройства ),
 * в памяти живут открытыми — иначе подстановку в чате не сделать.
 * Наружу (интерфейс, движок чата) отдаём `TokenEntry` с открытым значением.
 *
 * v3: значение, падежи и заметка лежат одним запечатанным блоком
 * (`sealedPayload`). Открытые `variants`/`note` — признак записи v2,
 * их прячет ленивая миграция при загрузке.
 */

import { ref } from "vue";
import type { TokenRecord, TokenSource, TokenType } from "@/storage/types";
import {
  deleteTokenRecord,
  listTokenRecords,
  putTokenRecord,
} from "@/storage/tokens";
import {
  openTokenPayload,
  openTokenValue,
  sealTokenPayload,
  sealTokenValue,
  type TokenPayload,
} from "@/crypto/token-cipher";
import { CryptoUnavailableError } from "@/crypto/subtle";
import { isValidTokenName, normalizeTokenName, tokenNameKey, tokensToValues } from "./format";
import { valuesToTokens, type SubstitutionResult } from "./substitute";
import { withDeclensions } from "./morph/service";
import type { TransferEntry } from "./transfer";
import { planMerge, type MergeConflict, type MergePolicy } from "./merge";
import { newId } from "@/lib/id";

/**
 * Запись справочника с открытым значением.
 *
 * `caseSensitive` — свойство самой записи, а не диалога и не серии замен:
 * для одного токена «ВТБ» и «втб» — разные значения, для другого — одно и то же.
 */
export interface TokenEntry {
  id: string;
  name: string;
  value: string;
  note?: string;
  variants?: string[];
  caseSensitive?: boolean;
  /** Сессия, где токен создан. Значение живёт в ней, если токен не общий. */
  sessionId?: string;
  /** Общий токен: значение подсвечивается в любом диалоге. */
  shared?: boolean;
  /** Тип сущности. Нет поля — старая запись, читается как `generic`. */
  type?: TokenType;
  /** Номер в серии типа: «имя-1», «адрес-2». */
  ordinal?: number;
  /** Кто создал: человек или автоподсказка. */
  source?: TokenSource;
  /** Уверенность детектора 0..1. */
  confidence?: number;
  createdAt: number;
  updatedAt: number;
}

export type TokenErrorCode =
  | "name_required"
  | "name_invalid"
  | "name_duplicate"
  | "value_required"
  | "save_failed"
  | "insecure_context";

export class TokenError extends Error {
  readonly code: TokenErrorCode;

  constructor(code: TokenErrorCode) {
    super(code);
    this.name = "TokenError";
    this.code = code;
  }
}

export const tokenEntries = ref<TokenEntry[]>([]);
export const tokensLoaded = ref(false);
/** Сколько записей не удалось расшифровать (сменился ключ устройства). */
export const tokensBroken = ref(0);

function toEntry(record: TokenRecord, payload: TokenPayload): TokenEntry {
  return {
    id: record.id,
    name: record.name,
    value: payload.value,
    ...(payload.note ? { note: payload.note } : {}),
    ...(payload.variants && payload.variants.length > 0 ? { variants: payload.variants } : {}),
    ...(record.caseSensitive ? { caseSensitive: true } : {}),
    ...(record.sessionId ? { sessionId: record.sessionId } : {}),
    ...(record.shared === true ? { shared: true } : record.shared === false ? { shared: false } : {}),
    ...(record.type ? { type: record.type } : {}),
    ...(record.ordinal !== undefined ? { ordinal: record.ordinal } : {}),
    ...(record.source ? { source: record.source } : {}),
    ...(record.confidence !== undefined ? { confidence: record.confidence } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Открыть запись: сначала конверт v3, затем (для старых) значение + открытые
 * падежи и заметка.
 */
async function readRecordPayload(record: TokenRecord): Promise<TokenPayload> {
  if (record.sealedPayload) {
    const opened = await openTokenPayload(record.sealedPayload, record.id);
    if (opened) return opened;
  }
  const value = await openTokenValue(record.sealedValue, record.id);
  return {
    value,
    ...(record.variants && record.variants.length > 0 ? { variants: record.variants } : {}),
    ...(record.note ? { note: record.note } : {}),
  };
}

/**
 * v2 → v3: спрятать падежи и заметку в конверт.
 *
 * Ошибка шифрования (нет сида, http) не ломает чтение: запись остаётся v2
 * и будет переписана при следующем запуске на нормальном устройстве.
 */
async function sealLegacyRecord(record: TokenRecord, payload: TokenPayload): Promise<void> {
  if (record.sealedPayload) return;
  if (!payload.variants && !payload.note) return;
  try {
    const sealedPayload = await sealTokenPayload(payload, record.id);
    const next: TokenRecord = { ...record, sealedPayload };
    delete next.variants;
    delete next.note;
    await putTokenRecord(next);
  } catch {
    // см. комментарий выше
  }
}

/**
 * Значение этой записи видно в диалоге.
 *
 * Общий токен — в любом. Токен с сессией — только в ней. Старая запись без
 * сессии и без явного «не общий» остаётся общей, как справочник раньше.
 */
export function tokenInSession(
  entry: { sessionId?: string; shared?: boolean },
  sessionId: string | null | undefined,
): boolean {
  if (entry.shared === true) return true;
  if (entry.sessionId) return entry.sessionId === sessionId;
  return entry.shared !== false;
}

/** Запись помечена общей (или это старый справочник без сессии). */
export function tokenIsCommon(entry: { sessionId?: string; shared?: boolean }): boolean {
  if (entry.shared === true) return true;
  if (entry.sessionId) return false;
  return entry.shared !== false;
}

/** Записи, чьи значения можно показывать и подсвечивать в этом диалоге. */
export function entriesForSession(
  sessionId: string | null | undefined,
  entries: readonly TokenEntry[] = tokenEntries.value,
): TokenEntry[] {
  return entries.filter((entry) => tokenInSession(entry, sessionId));
}

/** Прочитать справочник из базы, расшифровать значения, спрятать v2-хвосты. */
export async function loadTokens(): Promise<void> {
  const records = await listTokenRecords();
  const result: TokenEntry[] = [];
  let broken = 0;
  for (const record of records) {
    try {
      const payload = await readRecordPayload(record);
      result.push(toEntry(record, payload));
      await sealLegacyRecord(record, payload);
    } catch {
      broken += 1;
    }
  }
  tokenEntries.value = result;
  tokensBroken.value = broken;
  tokensLoaded.value = true;
}

export interface TokenInput {
  /** id — правка существующей записи; без него создаётся новая. */
  id?: string;
  name: string;
  value: string;
  note?: string;
  variants?: string[];
  /** Учитывать регистр при поиске значения (по умолчанию нет). */
  caseSensitive?: boolean;
  /** Сессия-владелец. Пусто — токен не привязан к диалогу. */
  sessionId?: string;
  /** Общий токен подсвечивается в любом диалоге. */
  shared?: boolean;
  /** Тип сущности (из справочника типов). */
  type?: TokenType;
  /** Номер в серии типа. */
  ordinal?: number;
  /** Кто создал запись. */
  source?: TokenSource;
  /** Уверенность детектора 0..1. */
  confidence?: number;
}

function normalizeVariants(input: string[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of input ?? []) {
    const value = String(item ?? "").replace(/\s+/g, " ").trim();
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    result.push(value);
  }
  return result;
}

function sessionFields(
  input: TokenInput,
  existing: TokenEntry | undefined,
): { sessionId?: string; shared?: boolean } {
  const sessionId = input.sessionId !== undefined ? input.sessionId : existing?.sessionId;
  const shared = input.shared !== undefined ? input.shared : existing?.shared;
  return {
    ...(sessionId ? { sessionId } : {}),
    ...(shared === true ? { shared: true } : shared === false ? { shared: false } : {}),
  };
}

function typeFields(
  input: TokenInput,
  existing: TokenEntry | undefined,
): { type?: TokenType; ordinal?: number; source?: TokenSource; confidence?: number } {
  const type = input.type ?? existing?.type;
  const ordinal = input.ordinal ?? existing?.ordinal;
  const source = input.source ?? existing?.source;
  const confidence = input.confidence ?? existing?.confidence;
  return {
    ...(type ? { type } : {}),
    ...(ordinal !== undefined ? { ordinal } : {}),
    ...(source ? { source } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
  };
}

function validate(input: TokenInput): { name: string; nameKey: string; value: string } {
  const name = normalizeTokenName(input.name);
  if (!name) throw new TokenError("name_required");
  if (!isValidTokenName(name)) throw new TokenError("name_invalid");
  const value = String(input.value ?? "").trim();
  if (!value) throw new TokenError("value_required");
  return { name, nameKey: tokenNameKey(name), value };
}

/**
 * Сохранить запись: новую или правку существующей.
 * Имя уникально без учёта регистра — совпадение с другой записью это ошибка.
 */
export async function saveToken(input: TokenInput): Promise<TokenEntry> {
  const { name, nameKey, value } = validate(input);
  const duplicate = tokenEntries.value.find(
    (entry) => tokenNameKey(entry.name) === nameKey && entry.id !== input.id,
  );
  if (duplicate) throw new TokenError("name_duplicate");

  const existing = input.id ? tokenEntries.value.find((entry) => entry.id === input.id) : undefined;
  const id = input.id ?? newId("tok");
  const now = Date.now();
  const variants = normalizeVariants(input.variants);
  const note = String(input.note ?? "").trim();
  const payload: TokenPayload = {
    value,
    ...(variants.length > 0 ? { variants } : {}),
    ...(note ? { note } : {}),
  };

  let sealedValue: string;
  let sealedPayload: string;
  try {
    sealedValue = await sealTokenValue(value, id);
    sealedPayload = await sealTokenPayload(payload, id);
  } catch (error) {
    // Нет WebCrypto — сайт открыт по http; это не «нет хранилища», и лечится иначе.
    if (error instanceof CryptoUnavailableError) throw new TokenError("insecure_context");
    throw new TokenError("save_failed");
  }

  const record: TokenRecord = {
    id,
    name,
    nameKey,
    sealedValue,
    sealedPayload,
    ...(input.caseSensitive ? { caseSensitive: true } : {}),
    ...typeFields(input, existing),
    ...sessionFields(input, existing),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await putTokenRecord(record);
  await loadTokens();
  return toEntry(record, payload);
}

/** Удалить запись справочника. */
export async function removeToken(id: string): Promise<void> {
  await deleteTokenRecord(id);
  await loadTokens();
}

/** Запись справочника по имени токена (без учёта регистра). */
export function tokenEntryByName(name: string): TokenEntry | undefined {
  const key = tokenNameKey(name);
  if (!key) return undefined;
  return tokenEntries.value.find((entry) => tokenNameKey(entry.name) === key);
}

/** Значение по имени токена (без учёта регистра). */
export function tokenLookup(name: string): string | undefined {
  return tokenEntryByName(name)?.value;
}

/** Текст для чтения: токены → значения. Неизвестные токены остаются как есть. */
export function restoreValues(text: string): string {
  return tokensToValues(text, tokenLookup);
}

/**
 * Текст для хранения и отправки: значения → токены.
 *
 * Если скачан морфологический словарь, к записям дописываются падежные
 * написания — иначе «вклада ВТБ» ушло бы агенту открытым текстом только
 * потому, что человек написал значение в другом падеже.
 */
export function replaceValues(
  text: string,
  onHit?: (hit: { name: string; form: string }) => void,
  entries?: readonly TokenEntry[],
): SubstitutionResult {
  return valuesToTokens(text, withDeclensions(entries ?? tokenEntries.value), onHit);
}

export interface ImportSummary {
  added: number;
  replaced: number;
  kept: number;
}

/**
 * Сохранить записи из файла переноса.
 *
 * `decide` вызывается только на совпадениях имён. Заменённая запись получает
 * id прежней — так уникальный индекс по имени не ломается.
 */
export async function importTokenEntries(
  incoming: TransferEntry[],
  decide?: (conflict: MergeConflict) => MergePolicy,
): Promise<ImportSummary> {
  const plan = planMerge(tokenEntries.value, incoming, decide);
  let added = 0;
  let replaced = 0;
  for (const entry of plan.write) {
    const existing = tokenEntries.value.find(
      (item) => tokenNameKey(item.name) === tokenNameKey(entry.name),
    );
    await saveToken({
      id: existing?.id,
      name: entry.name,
      value: entry.value,
      note: entry.note,
      variants: entry.variants,
      caseSensitive: entry.caseSensitive,
    });
    if (existing) replaced += 1;
    else added += 1;
  }
  return { added, replaced, kept: plan.kept.length };
}

/** Записи в виде, пригодном для файла переноса. */
export function transferEntries(): TransferEntry[] {
  return tokenEntries.value.map((entry) => ({
    name: entry.name,
    value: entry.value,
    ...(entry.note ? { note: entry.note } : {}),
    ...(entry.variants && entry.variants.length > 0 ? { variants: entry.variants } : {}),
    ...(entry.caseSensitive ? { caseSensitive: true } : {}),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }));
}
