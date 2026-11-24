/**
 * Шифрование значений справочника ключом устройства.
 *
 * Тот же примитив, что у ключей агентов (`agent-key-cipher.ts`):
 *   device seed (32 случайных байта в хранилище браузера)
 *     -> HKDF-SHA256 (своя соль и info — отдельный ключ)
 *     -> AES-GCM-256, additionalData = id записи
 *
 * Отдельного пароля при открытии нет: справочник расшифровывается в памяти
 * на своём устройстве. Пароль есть только у файла переноса (`transfer.ts`).
 */

import { AgentKeyCipherError, ensureDeviceSeed } from "@/crypto/agent-key-cipher";
import { requireSubtleCrypto, secureRandom } from "@/crypto/subtle";

const AES_GCM = "AES-GCM";
const HKDF = "HKDF";
const SHA_256 = "SHA-256";
const AES_KEY_BITS = 256;
const RAW_KEY_FORMAT = "raw";
const IV_BYTES = 12;

/** Префикс конверта значения. */
export const TOKEN_VALUE_PREFIX = "enc:tk1:";

/** Соль и info HKDF: отделяют ключ справочника от ключа агентов. */
export const TOKEN_KDF_SALT = "gena.token.v1";
export const TOKEN_KDF_INFO = "gena-token-value";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type TokenCipherErrorCode = "missing_seed" | "decrypt_failed";

export class TokenCipherError extends Error {
  readonly code: TokenCipherErrorCode;

  constructor(code: TokenCipherErrorCode) {
    super(code);
    this.name = "TokenCipherError";
    this.code = code;
  }
}

let cachedSeed = "";
let cachedKey: Promise<CryptoKey> | null = null;

/** Сбросить кэш производного ключа (тесты, смена сида). */
export function resetTokenCipherCache(): void {
  cachedSeed = "";
  cachedKey = null;
}

export function isSealedTokenValue(value: string): boolean {
  return value.startsWith(TOKEN_VALUE_PREFIX);
}

/** Запечатать значение. Привязка к записи через additionalData. */
export async function sealTokenValue(value: string, entryId: string): Promise<string> {
  if (!value) return "";
  const device = ensureDeviceSeed();
  if (!device.persisted) {
    throw new TokenCipherError("missing_seed");
  }
  const subtle = requireSubtleCrypto();
  const iv = secureRandom(IV_BYTES);
  const cipher = await subtle.encrypt(
    { name: AES_GCM, iv: iv as BufferSource, additionalData: textEncoder.encode(entryId) },
    await deriveKey(device.seed),
    textEncoder.encode(value),
  );
  return `${TOKEN_VALUE_PREFIX}${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(cipher))}`;
}

/** Распечатать значение. Открытый текст (старые записи) возвращается как есть. */
export async function openTokenValue(sealed: string, entryId: string): Promise<string> {
  if (!sealed) return "";
  if (!isSealedTokenValue(sealed)) return sealed;

  const device = ensureDeviceSeed();
  if (!device.persisted) {
    throw new TokenCipherError("missing_seed");
  }
  const subtle = requireSubtleCrypto();

  const payload = sealed.slice(TOKEN_VALUE_PREFIX.length);
  const separator = payload.indexOf(".");
  if (separator <= 0) throw new TokenCipherError("decrypt_failed");

  const iv = base64ToBytes(payload.slice(0, separator));
  const cipher = base64ToBytes(payload.slice(separator + 1));
  if (!iv || !cipher || iv.length !== IV_BYTES) throw new TokenCipherError("decrypt_failed");

  try {
    const plain = await subtle.decrypt(
      { name: AES_GCM, iv: iv as BufferSource, additionalData: textEncoder.encode(entryId) },
      await deriveKey(device.seed),
      cipher as BufferSource,
    );
    return textDecoder.decode(plain);
  } catch {
    throw new TokenCipherError("decrypt_failed");
  }
}

async function deriveKey(seed: string): Promise<CryptoKey> {
  if (cachedKey && cachedSeed === seed) return cachedKey;

  const subtle = requireSubtleCrypto();
  const pending = subtle
    .importKey(RAW_KEY_FORMAT, textEncoder.encode(seed), HKDF, false, ["deriveKey"])
    .then((material) =>
      subtle.deriveKey(
        {
          name: HKDF,
          hash: SHA_256,
          salt: textEncoder.encode(TOKEN_KDF_SALT),
          info: textEncoder.encode(TOKEN_KDF_INFO),
        },
        material,
        { name: AES_GCM, length: AES_KEY_BITS },
        false,
        ["encrypt", "decrypt"],
      ),
    )
    .catch((error: unknown) => {
      if (cachedSeed === seed) {
        cachedSeed = "";
        cachedKey = null;
      }
      throw error;
    });

  cachedSeed = seed;
  cachedKey = pending;
  return pending;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Ошибка шифрования ключей агента тоже годится: тот же сид устройства. */
export function isSeedError(error: unknown): boolean {
  return (
    error instanceof TokenCipherError ||
    error instanceof AgentKeyCipherError
  );
}
