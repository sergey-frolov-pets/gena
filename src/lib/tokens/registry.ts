/**
 * Справочник подстановок в памяти и на диске.
 *
 * На диск значения попадают только запечатанными ( ключ устройства ),
 * в памяти живут открытыми — иначе подстановку в чате не сделать.
 * Наружу (интерфейс, движок чата) отдаём `TokenEntry` с открытым значением.
 */

import { ref } from "vue";
import type { TokenRecord } from "@/storage/types";
import {
  deleteTokenRecord,
  listTokenRecords,
  putTokenRecord,
} from "@/storage/tokens";
import { openTokenValue, sealTokenValue } from "@/crypto/token-cipher";
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
  createdAt: number;
  updatedAt: number;
}

export type TokenErrorCode =
  | "name_required"
  | "name_invalid"
  | "name_duplicate"
  | "value_required"
  | "save_failed";

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

function toEntry(record: TokenRecord, value: string): TokenEntry {
  return {
    id: record.id,
    name: record.name,
    value,
    ...(record.note ? { note: record.note } : {}),
    ...(record.variants && record.variants.length > 0 ? { variants: record.variants } : {}),
    ...(record.caseSensitive ? { caseSensitive: true } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Прочитать справочник из базы и расшифровать значения. */
export async function loadTokens(): Promise<void> {
  const records = await listTokenRecords();
  const result: TokenEntry[] = [];
  let broken = 0;
  for (const record of records) {
    try {
      result.push(toEntry(record, await openTokenValue(record.sealedValue, record.id)));
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

  let sealedValue: string;
  try {
    sealedValue = await sealTokenValue(value, id);
  } catch {
    throw new TokenError("save_failed");
  }

  const record: TokenRecord = {
    id,
    name,
    nameKey,
    sealedValue,
    ...(note ? { note } : {}),
    ...(variants.length > 0 ? { variants } : {}),
    ...(input.caseSensitive ? { caseSensitive: true } : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await putTokenRecord(record);
  await loadTokens();
  return toEntry(record, value);
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
export function replaceValues(text: string): SubstitutionResult {
  return valuesToTokens(text, withDeclensions(tokenEntries.value));
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
