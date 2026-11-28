/**
 * Настройка «поиск персональных данных моделью» — отдельное подключение
 * в разделе «Подключения».
 *
 * Правило продукта: пока адрес и модель не заданы, работает только локальный
 * детектор. Включённая настройка меняет вид щита (значок «S»), но не отменяет
 * локальный слой — он остаётся страховкой при недоступной модели.
 *
 * Ключ хранится запечатанным (`enc:v1:…`), как ключи агентов: в открытом виде
 * он не попадает ни в localStorage, ни в бэкап настроек.
 */

import { ref } from "vue";

import { openAgentKey, sealAgentKey } from "@/crypto/agent-key-cipher";

export interface PrivacyModelSettings {
  enabled: boolean;
  /** База адреса, например `http://127.0.0.1:8787`. */
  address: string;
  model: string;
  /** Конверт `enc:v1:…`; пустая строка — ключ не задан. */
  sealedKey: string;
}

const STORAGE_KEY = "gena.privacy-model";
/** additionalData для AES-GCM: привязка конверта к назначению. */
const SEAL_ID = "privacy-model";

const EMPTY: PrivacyModelSettings = {
  enabled: false,
  address: "",
  model: "",
  sealedKey: "",
};

/** Адрес: только http(s), без хвостового слэша. Пустая строка — не задан. */
export function normalizePrivacyAddress(raw: string): string {
  const value = String(raw ?? "").trim().replace(/\/+$/, "");
  if (!value) return "";
  if (!/^https?:\/\/[^\s]+$/i.test(value)) return "";
  return value;
}

/** Полный адрес чат-эндпоинта. Поддерживает базу и базу с `/v1`. */
export function privacyChatUrl(address: string): string {
  const base = normalizePrivacyAddress(address);
  if (!base) return "";
  return /\/v1$/i.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

/** Настройка готова к работе: включена, есть адрес и модель. */
export function isPrivacyModelReady(settings: PrivacyModelSettings): boolean {
  return (
    settings.enabled === true &&
    normalizePrivacyAddress(settings.address) !== "" &&
    settings.model.trim() !== ""
  );
}

function read(): PrivacyModelSettings {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<PrivacyModelSettings> | null;
    if (!parsed || typeof parsed !== "object") return { ...EMPTY };
    return {
      enabled: parsed.enabled === true,
      address: normalizePrivacyAddress(String(parsed.address ?? "")),
      model: String(parsed.model ?? "").trim(),
      sealedKey: String(parsed.sealedKey ?? ""),
    };
  } catch {
    return { ...EMPTY };
  }
}

/** Реактивная настройка: меняется в «Подключениях», читается щитом. */
export const privacyModel = ref<PrivacyModelSettings>(read());

export interface PrivacyModelInput {
  enabled: boolean;
  address: string;
  model: string;
  /** `undefined` — не менять ключ; `""` — стереть; иначе — новый ключ. */
  key?: string;
}

/** Сохранить настройку. Возвращает то, что реально записано. */
export async function savePrivacyModel(input: PrivacyModelInput): Promise<PrivacyModelSettings> {
  const previous = privacyModel.value;
  let sealedKey = previous.sealedKey;
  if (input.key !== undefined) {
    const key = input.key.trim();
    sealedKey = key ? await sealAgentKey(key, SEAL_ID) : "";
  }

  const next: PrivacyModelSettings = {
    enabled: input.enabled === true,
    address: normalizePrivacyAddress(input.address),
    model: input.model.trim(),
    sealedKey,
  };

  privacyModel.value = next;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Приватный режим браузера: настройка живёт до перезагрузки.
  }
  return next;
}

/** Расшифровать ключ для запроса. Пустая строка — ключ не задан. */
export async function readPrivacyModelKey(
  settings: PrivacyModelSettings = privacyModel.value,
): Promise<string> {
  if (!settings.sealedKey) return "";
  return openAgentKey(settings.sealedKey, SEAL_ID);
}
