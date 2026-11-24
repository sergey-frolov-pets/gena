/**
 * Шифрование ключей агентов.
 *
 * Паттерн повторяет code2graph (`llm-key-cipher.ts`):
 *   device seed (случайные 32 байта в localStorage)
 *     -> HKDF-SHA256 (соль + info)
 *     -> AES-GCM-256
 *   конверт: "enc:v2:<base64(iv)>.<base64(cipher)>", additionalData = agentId
 *
 * Отличие от code2graph: нет legacy-конвертов из .env-сида — Gena полностью
 * клиентская, сид всегда на устройстве. Смена версии сборки не ломает ключи.
 */

import { requireSubtleCrypto, secureRandom } from "@/crypto/subtle";

const AES_GCM = "AES-GCM";
const HKDF = "HKDF";const SHA_256 = "SHA-256";
const AES_KEY_BITS = 256;
const RAW_KEY_FORMAT = "raw";

const DEVICE_SEED_BYTES = 32;
const IV_BYTES = 12;

/** Префикс конверта. Версия v1 — первая и единственная схема Gena. */
export const AGENT_KEY_CIPHER_PREFIX = "enc:v1:";

/** Соль и info для HKDF. Не секрет: отделяют ключ шифрования от иных применений сида. */
export const AGENT_KEY_KDF_SALT = "gena.agent-key.v1";
export const AGENT_KEY_KDF_INFO = "gena-agent-api-key";

/** Ключ в localStorage, где лежит device seed (base64). */
export const STORAGE_KEY_DEVICE_SEED = "gena-device-seed";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type AgentKeyCipherErrorCode = "missing_seed" | "decrypt_failed";

export class AgentKeyCipherError extends Error {
  readonly code: AgentKeyCipherErrorCode;

  constructor(code: AgentKeyCipherErrorCode) {
    super(code);
    this.name = "AgentKeyCipherError";
    this.code = code;
  }
}

let cachedSeed = "";
let cachedKey: Promise<CryptoKey> | null = null;
let deviceSeedCache: { seed: string; persisted: boolean } | null = null;

export function resetAgentKeyCipherCache(): void {
  cachedSeed = "";
  cachedKey = null;
  deviceSeedCache = null;
}

function isUsableSeed(seed: string): boolean {
  return seed.trim().length >= 16;
}

/** Доступ к localStorage с защитой от приватного режима / SSR. */
function readStorageItem(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStorageItem(key: string, value: string): boolean {
  try {
    globalThis.localStorage?.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Сид этого браузера. `persisted: false` — localStorage недоступен,
 * перешифровывать ключи на диске нельзя.
 */
export function ensureDeviceSeed(): { seed: string; persisted: boolean } {
  if (deviceSeedCache) {
    return deviceSeedCache;
  }

  const existing = readStorageItem(STORAGE_KEY_DEVICE_SEED)?.trim() ?? "";
  if (isUsableSeed(existing)) {
    deviceSeedCache = { seed: existing, persisted: true };
    return deviceSeedCache;
  }

  const seed = bytesToBase64(secureRandom(DEVICE_SEED_BYTES));
  const wrote = writeStorageItem(STORAGE_KEY_DEVICE_SEED, seed);
  const winner = readStorageItem(STORAGE_KEY_DEVICE_SEED)?.trim() ?? "";
  if (wrote && isUsableSeed(winner)) {
    deviceSeedCache = { seed: winner, persisted: true };
    return deviceSeedCache;
  }

  deviceSeedCache = { seed, persisted: false };
  return deviceSeedCache;
}

export function canPersistSecrets(): boolean {
  return ensureDeviceSeed().persisted;
}

export function isSealedAgentKey(value: string): boolean {
  return value.startsWith(AGENT_KEY_CIPHER_PREFIX);
}

/** Запечатать ключ агента. Привязка к agentId через additionalData. */
export async function sealAgentKey(apiKey: string, agentId: string): Promise<string> {
  if (!apiKey) {
    return "";
  }

  const device = ensureDeviceSeed();
  if (!device.persisted) {
    throw new AgentKeyCipherError("missing_seed");
  }

  return encryptWithSeed(apiKey, device.seed, agentId);
}

/** Распечатать ключ агента. */
export async function openAgentKey(stored: string, agentId: string): Promise<string> {
  if (!stored) {
    return "";
  }

  if (!isSealedAgentKey(stored)) {
    // Не запечатан — значит, открытый текст (миграция/ручной ввод).
    return stored;
  }

  const device = ensureDeviceSeed();
  if (!device.persisted) {
    throw new AgentKeyCipherError("missing_seed");
  }

  return decryptWithSeed(stored, device.seed, agentId);
}

async function encryptWithSeed(apiKey: string, seed: string, agentId: string): Promise<string> {
  const subtle = requireSubtleCrypto();
  const iv = secureRandom(IV_BYTES);
  const cipher = await subtle.encrypt(
    {
      name: AES_GCM,
      iv: iv as BufferSource,
      additionalData: textEncoder.encode(agentId),
    },
    await deriveAesKey(seed),
    textEncoder.encode(apiKey),
  );

  return `${AGENT_KEY_CIPHER_PREFIX}${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(cipher))}`;
}

async function decryptWithSeed(stored: string, seed: string, agentId: string): Promise<string> {
  const payload = stored.slice(AGENT_KEY_CIPHER_PREFIX.length);
  const separator = payload.indexOf(".");
  if (separator <= 0) {
    throw new AgentKeyCipherError("decrypt_failed");
  }

  const iv = base64ToBytes(payload.slice(0, separator));
  const cipher = base64ToBytes(payload.slice(separator + 1));
  if (!iv || !cipher || iv.length !== IV_BYTES) {
    throw new AgentKeyCipherError("decrypt_failed");
  }

  const subtle = requireSubtleCrypto();
  try {
    const plain = await subtle.decrypt(
      {
        name: AES_GCM,
        iv: iv as BufferSource,
        additionalData: textEncoder.encode(agentId),
      },
      await deriveAesKey(seed),
      cipher as BufferSource,
    );
    return textDecoder.decode(plain);
  } catch (error) {
    if (error instanceof AgentKeyCipherError) {
      throw error;
    }
    throw new AgentKeyCipherError("decrypt_failed");
  }
}

async function deriveAesKey(seed: string): Promise<CryptoKey> {
  if (cachedKey && cachedSeed === seed) {
    return cachedKey;
  }

  const subtle = requireSubtleCrypto();
  const pending = subtle
    .importKey(RAW_KEY_FORMAT, textEncoder.encode(seed), HKDF, false, ["deriveKey"])
    .then((material) =>
      subtle.deriveKey(
        {
          name: HKDF,
          hash: SHA_256,
          salt: textEncoder.encode(AGENT_KEY_KDF_SALT),
          info: textEncoder.encode(AGENT_KEY_KDF_INFO),
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
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}
