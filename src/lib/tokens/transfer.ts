/**
 * Файл переноса справочника между устройствами.
 *
 * Один файл, один пароль — и ничего больше: ни слотов устройств, ни сервера.
 * Пароль вводится руками и не совпадает с паролем сейфа (его здесь и нет):
 * файл может лежать в почте или на флешке, поэтому требования к нему отдельные.
 *
 * Формат:
 *   { format: "gena.tokens", version: 2, createdAt, count,
 *     kdf: { name: "PBKDF2-SHA256", iterations, salt },
 *     cipher: { name: "AES-GCM", iv },
 *     payload: "<base64 AES-GCM>" }
 *
 * Версия 2 добавляет к записи тип, источник, уверенность и правила подстановки
 * (`type`, `source`, `confidence`, `numberMode`, `percentHint`, `allowForAgent`).
 * Файлы версии 1 читаются как прежде: тип считается `generic`, источник — `user`.
 * `canonicalKey` НЕ переносится: он считается от seed устройства, поэтому на
 * новом устройстве пересчитывается из самого значения при импорте.
 *
 * Ключ: PBKDF2-SHA256(пароль, salt, iterations) -> AES-GCM-256.
 * Всё, что нужно для расшифровки, лежит в заголовке открыто — это нормально для
 * PBKDF2 (соль не секрет), а параметры KDF привязаны к шифротексту через AAD:
 * подменить число итераций незаметно не получится.
 */

import { isValidTokenName, normalizeTokenName } from "@/lib/tokens/format";
import { requireSubtleCrypto, secureRandom } from "@/crypto/subtle";
import type {
  TokenAllowForAgent,
  TokenNumberMode,
  TokenPercentHint,
  TokenSource,
  TokenType,
} from "@/storage/types";

export const TOKENS_FILE_FORMAT = "gena.tokens";
export const TOKENS_FILE_VERSION = 2;

/** Минимальная длина пароля файла переноса. */
export const TRANSFER_MIN_PASSWORD = 12;

/** Число итераций PBKDF2 по умолчанию. В тестах передаётся меньшее. */
export const TRANSFER_ITERATIONS = 210_000;

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_VALUE_LEN = 4000;
const MAX_NAME_LEN = 80;
const MAX_NOTE_LEN = 500;
const MAX_VARIANTS = 50;
const SALT_BYTES = 16;
const IV_BYTES = 12;

const KDF_NAME = "PBKDF2-SHA256";
const CIPHER_NAME = "AES-GCM";

export interface TransferEntry {
  name: string;
  value: string;
  note?: string;
  variants?: string[];
  /** Учитывать регистр — свойство записи, переносится вместе с ней. */
  caseSensitive?: boolean;
  createdAt?: number;
  updatedAt?: number;
  /** Тип сущности (v2). */
  type?: TokenType;
  /** Кто создал запись (v2). */
  source?: TokenSource;
  /** Уверенность детектора 0..1 (v2). */
  confidence?: number;
  /** Режим подстановки числа (v2). */
  numberMode?: TokenNumberMode;
  /** Что делать с процентом (v2). */
  percentHint?: TokenPercentHint;
  /** Разрешение отправить значением (v2). */
  allowForAgent?: TokenAllowForAgent;
}

const TOKEN_TYPE_VALUES = [
  "person",
  "phone",
  "email",
  "account",
  "date",
  "amount",
  "discount",
  "term",
  "company",
  "geo",
  "software",
  "equipment",
  "contract",
  "generic",
] as const;
const TOKEN_SOURCE_VALUES = ["user", "auto"] as const;
const NUMBER_MODE_VALUES = ["placeholder", "scale"] as const;
const PERCENT_HINT_VALUES = ["keep", "shift"] as const;
const ALLOW_FOR_AGENT_VALUES = ["never", "per-send"] as const;

function asEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/** Поля v2: неизвестное значение молча отбрасывается, запись остаётся целой. */
function tokenExtras(record: Record<string, unknown>): Partial<TransferEntry> {
  const type = asEnum(record.type, TOKEN_TYPE_VALUES);
  const source = asEnum(record.source, TOKEN_SOURCE_VALUES);
  const numberMode = asEnum(record.numberMode, NUMBER_MODE_VALUES);
  const percentHint = asEnum(record.percentHint, PERCENT_HINT_VALUES);
  const allowForAgent = asEnum(record.allowForAgent, ALLOW_FOR_AGENT_VALUES);
  const rawConfidence = record.confidence;
  const confidence =
    typeof rawConfidence === "number" &&
    Number.isFinite(rawConfidence) &&
    rawConfidence >= 0 &&
    rawConfidence <= 1
      ? rawConfidence
      : undefined;
  return {
    ...(type ? { type } : {}),
    ...(source ? { source } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
    ...(numberMode ? { numberMode } : {}),
    ...(percentHint ? { percentHint } : {}),
    ...(allowForAgent ? { allowForAgent } : {}),
  };
}

export type TransferErrorCode =
  | "password_required"
  | "password_too_short"
  | "no_entries"
  | "bad_file"
  | "unsupported_version"
  | "wrong_password";

export class TransferError extends Error {
  readonly code: TransferErrorCode;

  constructor(code: TransferErrorCode) {
    super(code);
    this.name = "TransferError";
    this.code = code;
  }
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Проверка пароля файла: пустой и короткий — разные подсказки. */
export function checkTransferPassword(password: string): TransferErrorCode | null {
  const value = String(password ?? "");
  if (!value.trim()) return "password_required";
  if ([...value].length < TRANSFER_MIN_PASSWORD) return "password_too_short";
  return null;
}

/** Привести записи к виду файла: без id и служебных ключей. */
function normalizeForTransfer(entries: TransferEntry[]): TransferEntry[] {
  const seen = new Set<string>();
  const result: TransferEntry[] = [];
  for (const entry of entries) {
    const name = normalizeTokenName(entry.name);
    if (!isValidTokenName(name) || name.length > MAX_NAME_LEN) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    const value = String(entry.value ?? "").trim().slice(0, MAX_VALUE_LEN);
    if (!value) continue;
    const variants = (entry.variants ?? [])
      .map((item) => String(item ?? "").replace(/\s+/g, " ").trim())
      .filter((item) => item && item.length <= MAX_VALUE_LEN)
      .slice(0, MAX_VARIANTS);
    const note = String(entry.note ?? "").trim().slice(0, MAX_NOTE_LEN);
    seen.add(key);
    result.push({
      name,
      value,
      ...(note ? { note } : {}),
      ...(variants.length > 0 ? { variants } : {}),
      ...(entry.caseSensitive ? { caseSensitive: true } : {}),
      ...(typeof entry.createdAt === "number" ? { createdAt: entry.createdAt } : {}),
      ...(typeof entry.updatedAt === "number" ? { updatedAt: entry.updatedAt } : {}),
      ...tokenExtras(entry as unknown as Record<string, unknown>),
    });
  }
  return result;
}

function headerAad(version: number, iterations: number, salt: string): Uint8Array {
  return textEncoder.encode(`${TOKENS_FILE_FORMAT}|${version}|${KDF_NAME}|${iterations}|${salt}`);
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  const subtle = requireSubtleCrypto();
  const material = await subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as unknown as BufferSource, iterations },
    material,
    { name: CIPHER_NAME, length: 256 },
    false,
    usages,
  );
}

/** Собрать зашифрованный файл переноса. */
export async function exportTokenFile(
  entries: TransferEntry[],
  password: string,
  options: { iterations?: number; now?: number } = {},
): Promise<string> {
  const problem = checkTransferPassword(password);
  if (problem) throw new TransferError(problem);

  const payloadEntries = normalizeForTransfer(entries);
  if (payloadEntries.length === 0) throw new TransferError("no_entries");

  const iterations = Math.round(options.iterations ?? TRANSFER_ITERATIONS);
  if (!Number.isFinite(iterations) || iterations < 1000 || iterations > 5_000_000) {
    throw new TransferError("bad_file");
  }

  const salt = secureRandom(SALT_BYTES);
  const iv = secureRandom(IV_BYTES);
  const saltB64 = bytesToBase64(salt);
  const createdAt = options.now ?? Date.now();

  const body = JSON.stringify({
    format: TOKENS_FILE_FORMAT,
    version: TOKENS_FILE_VERSION,
    createdAt,
    entries: payloadEntries,
  });

  const key = await deriveKey(password, salt, iterations, ["encrypt"]);
  const cipher = await requireSubtleCrypto().encrypt(
    {
      name: CIPHER_NAME,
      iv: iv as BufferSource,
      additionalData: headerAad(TOKENS_FILE_VERSION, iterations, saltB64) as unknown as BufferSource,
    },
    key,
    textEncoder.encode(body),
  );

  const file = {
    format: TOKENS_FILE_FORMAT,
    version: TOKENS_FILE_VERSION,
    createdAt,
    count: payloadEntries.length,
    kdf: { name: KDF_NAME, iterations, salt: saltB64 },
    cipher: { name: CIPHER_NAME, iv: bytesToBase64(iv) },
    payload: bytesToBase64(new Uint8Array(cipher)),
  };

  return `${JSON.stringify(file, null, 2)}\n`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function cleanEntries(raw: unknown): TransferEntry[] {
  if (!Array.isArray(raw)) throw new TransferError("bad_file");
  const result: TransferEntry[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const record = asRecord(item);
    if (!record) throw new TransferError("bad_file");
    const name = normalizeTokenName(String(record.name ?? ""));
    const value = String(record.value ?? "").trim();
    if (!isValidTokenName(name) || name.length > MAX_NAME_LEN) throw new TransferError("bad_file");
    if (!value || value.length > MAX_VALUE_LEN) throw new TransferError("bad_file");
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const note = String(record.note ?? "").trim().slice(0, MAX_NOTE_LEN);
    const variantsRaw = Array.isArray(record.variants) ? record.variants : [];
    const variants = variantsRaw
      .map((variant) => String(variant ?? "").replace(/\s+/g, " ").trim())
      .filter((variant) => variant && variant.length <= MAX_VALUE_LEN)
      .slice(0, MAX_VARIANTS);
    result.push({
      name,
      value,
      ...(note ? { note } : {}),
      ...(variants.length > 0 ? { variants } : {}),
      ...(record.caseSensitive === true ? { caseSensitive: true } : {}),
      ...(typeof record.createdAt === "number" ? { createdAt: record.createdAt } : {}),
      ...(typeof record.updatedAt === "number" ? { updatedAt: record.updatedAt } : {}),
      ...tokenExtras(record),
    });
  }
  if (result.length === 0) throw new TransferError("no_entries");
  return result;
}

/** Разобрать файл переноса: заголовок проверяется до расшифровки. */
export async function importTokenFile(text: string, password: string): Promise<TransferEntry[]> {
  const problem = checkTransferPassword(password);
  if (problem) throw new TransferError(problem);

  const raw = String(text ?? "");
  if (!raw.trim() || raw.length > MAX_FILE_BYTES) throw new TransferError("bad_file");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TransferError("bad_file");
  }

  const file = asRecord(parsed);
  if (!file || file.format !== TOKENS_FILE_FORMAT) throw new TransferError("bad_file");
  const version = Number(file.version);
  if (!Number.isInteger(version) || version < 1) throw new TransferError("bad_file");
  if (version > TOKENS_FILE_VERSION) throw new TransferError("unsupported_version");

  const kdf = asRecord(file.kdf);
  const cipher = asRecord(file.cipher);
  const iterations = Number(kdf?.iterations);
  const salt = base64ToBytes(String(kdf?.salt ?? ""));
  const iv = base64ToBytes(String(cipher?.iv ?? ""));
  const payload = base64ToBytes(String(file.payload ?? ""));

  if (kdf?.name !== KDF_NAME || cipher?.name !== CIPHER_NAME) throw new TransferError("bad_file");
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 5_000_000) {
    throw new TransferError("bad_file");
  }
  if (!salt || salt.length !== SALT_BYTES) throw new TransferError("bad_file");
  if (!iv || iv.length !== IV_BYTES) throw new TransferError("bad_file");
  if (!payload || payload.length === 0) throw new TransferError("bad_file");

  const key = await deriveKey(password, salt, iterations, ["decrypt"]);
  const subtle = requireSubtleCrypto();
  let plain: ArrayBuffer;
  try {
    plain = await subtle.decrypt(
      {
        name: CIPHER_NAME,
        iv: iv as BufferSource,
        additionalData: headerAad(version, iterations, bytesToBase64(salt)) as unknown as BufferSource,
      },
      key,
      payload as BufferSource,
    );
  } catch {
    throw new TransferError("wrong_password");
  }

  let body: unknown;
  try {
    body = JSON.parse(textDecoder.decode(plain));
  } catch {
    throw new TransferError("bad_file");
  }

  return cleanEntries(asRecord(body)?.entries);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array | null {
  if (!value) return null;
  try {
    const binary = atob(value);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}
