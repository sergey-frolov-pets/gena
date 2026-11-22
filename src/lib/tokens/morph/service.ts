/**
 * Морфологический словарь: состояние, загрузка и падежи для справочника.
 *
 * Словарь качается один раз (кнопка в «Справочнике»), лежит в базе устройства
 * и работает офлайн. Пока его нет, приложение ведёт себя как раньше: падежи
 * берутся только из явных `variants` записи.
 *
 * Явные варианты всегда главнее: движок подстановки берёт `variants` записи
 * первыми, а падежи из словаря дописываются в конец и не перекрывают их.
 */

import { computed, ref } from "vue";
import {
  MORPH_FORMAT,
  MORPH_VERSION,
  type MorphDictionary,
} from "./format";
import { buildMorphIndex, caseVariants, yoeForms, type MorphIndex } from "./analyze";
import { fetchMorphDictionary, MorphLoadError, MORPH_URL } from "./loader";
import { MORPH_ID, clearMorphRecord, readMorphRecord, writeMorphRecord } from "@/storage/morph";
import type { MorphRecord } from "@/storage/types";

export type MorphStatus = "idle" | "loading" | "ready" | "missing" | "error";

export interface MorphStats {
  lemmas: number;
  forms: number;
  bytes: number;
  downloadedAt: number;
  createdAt?: string;
  source?: string;
  license?: string;
}

export const morphStatus = ref<MorphStatus>("idle");
/** Прогресс скачивания 0…1 (0, если сервер не сообщил размер). */
export const morphProgress = ref(0);
export const morphError = ref("");
export const morphStats = ref<MorphStats | null>(null);
export const morphReady = computed(() => morphStatus.value === "ready");

let index: MorphIndex | null = null;
let loading: Promise<void> | null = null;
const cache = new Map<string, string[]>();
const CACHE_LIMIT = 400;

function resetCache(): void {
  cache.clear();
}

function adopt(record: MorphRecord): void {
  attachMorphDictionary(
    {
      format: MORPH_FORMAT,
      version: record.version ?? MORPH_VERSION,
      cases: record.cases,
      lemmas: record.lemmas,
      ...(record.createdAt ? { createdAt: record.createdAt } : {}),
      ...(record.source ? { source: record.source } : {}),
      ...(record.license ? { license: record.license } : {}),
    },
    { bytes: record.bytes, downloadedAt: record.downloadedAt },
  );
}

/**
 * Подключить словарь, уже находящийся в памяти.
 *
 * Используется после чтения из базы и после скачивания; отдельная функция
 * нужна ещё и тестам, где база не участвует.
 */
export function attachMorphDictionary(
  dictionary: MorphDictionary,
  meta: { bytes?: number; downloadedAt?: number } = {},
): void {
  index = buildMorphIndex(dictionary);
  resetCache();
  morphStats.value = {
    lemmas: index.lemmaCount,
    forms: index.formCount,
    bytes: meta.bytes ?? 0,
    downloadedAt: meta.downloadedAt ?? Date.now(),
    ...(dictionary.createdAt ? { createdAt: dictionary.createdAt } : {}),
    ...(dictionary.source ? { source: dictionary.source } : {}),
    ...(dictionary.license ? { license: dictionary.license } : {}),
  };
  morphStatus.value = "ready";
  morphError.value = "";
}

/** Прочитать словарь с устройства (вызывается при старте приложения). */
export async function loadMorph(): Promise<void> {
  if (loading) return loading;
  if (morphStatus.value === "ready") return;
  loading = (async () => {
    try {
      const record = await readMorphRecord();
      if (!record) {
        morphStatus.value = "missing";
        return;
      }
      adopt(record);
    } catch {
      // База недоступна или запись битая: работаем без словаря, но не падаем.
      index = null;
      morphStats.value = null;
      morphStatus.value = "missing";
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** Скачать словарь и положить его на устройство. */
export async function downloadMorph(url: string = MORPH_URL): Promise<void> {
  if (morphStatus.value === "loading") return;
  const previous = morphStatus.value === "ready";
  morphStatus.value = "loading";
  morphProgress.value = 0;
  morphError.value = "";
  try {
    const { dictionary, bytes } = await fetchMorphDictionary({
      url,
      onProgress: (loaded, total) => {
        morphProgress.value = total > 0 ? Math.min(1, loaded / total) : 0;
      },
    });
    const record: MorphRecord = {
      id: MORPH_ID,
      version: dictionary.version,
      cases: [...dictionary.cases],
      lemmas: dictionary.lemmas,
      bytes,
      downloadedAt: Date.now(),
      ...(dictionary.createdAt ? { createdAt: dictionary.createdAt } : {}),
      ...(dictionary.source ? { source: dictionary.source } : {}),
      ...(dictionary.license ? { license: dictionary.license } : {}),
    };
    await writeMorphRecord(record);
    adopt(record);
    morphProgress.value = 1;
  } catch (error) {
    morphStatus.value = previous ? "ready" : "error";
    morphError.value = error instanceof MorphLoadError ? error.code : "network";
  }
}

/** Удалить словарь с устройства: падежи снова берутся только из `variants`. */
export async function removeMorphDictionary(): Promise<void> {
  await clearMorphRecord();
  index = null;
  resetCache();
  morphStats.value = null;
  morphError.value = "";
  morphStatus.value = "missing";
}

/** Падежные написания значения по словарю (пусто, если словарь не скачан). */
export function declensionsFor(value: string): string[] {
  if (!index) return [];
  const key = String(value ?? "");
  const hit = cache.get(key);
  if (hit) return hit;
  const variants = caseVariants(key, index).variants;
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, variants);
  return variants;
}

/** Сколько слов значения словарь знает — для подсказки в интерфейсе. */
export function coverageFor(value: string): { covered: number; total: number; unknown: string[] } {
  if (!index) return { covered: 0, total: 0, unknown: [] };
  const result = caseVariants(String(value ?? ""), index);
  return { covered: result.covered, total: result.total, unknown: result.unknown };
}

export interface DeclinableEntry {
  value: string;
  variants?: string[];
}

/**
 * Дописать падежи из словаря к записям справочника.
 *
 * Явные варианты записи идут первыми — движок подстановки берёт первое
 * написание, встретившееся для токена, а дубли отбрасывает.
 */
export function withDeclensions<T extends DeclinableEntry>(entries: readonly T[]): T[] {
  if (!index || entries.length === 0) return entries as T[];
  let changed = false;
  const result = entries.map((entry) => {
    const own = String(entry.value ?? "");
    // Само значение и падежи — с «ё» и без: «счёт» и «счет» должны совпадать.
    const generated = [...yoeForms(own).slice(1), ...declensionsFor(own).flatMap(yoeForms)];
    if (generated.length === 0) return entry;
    const explicit = entry.variants ?? [];
    const known = new Set(explicit.map((item) => item.trim().toLowerCase()));
    known.add(own.trim().toLowerCase());
    const extra = generated.filter((form) => {
      const key = form.trim().toLowerCase();
      if (!key || known.has(key)) return false;
      known.add(key);
      return true;
    });
    if (extra.length === 0) return entry;
    changed = true;
    return { ...entry, variants: [...explicit, ...extra] };
  });
  return changed ? result : (entries as T[]);
}
