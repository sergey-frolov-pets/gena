/**
 * Список доверенных провайдеров — настройка приложения, не подключения.
 *
 * Хранится локально: это не секрет и не часть бэкапа подключений. Пустой список
 * значит «доверенных нет»: агент в режиме `trusted` тихо откатывается к токенам.
 */

import { ref } from "vue";

import { normalizeTrustedProviders } from "@/lib/privacy/mode";

const STORAGE_KEY = "gena.trusted-providers";

function read(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return normalizeTrustedProviders(parsed.map((item) => String(item)));
  } catch {
    return [];
  }
}

/** Реактивный список: меняется в одном месте — виден везде. */
export const trustedProviders = ref<string[]>(read());

/** Заменить список целиком (UI сохраняет textarea построчно). */
export function setTrustedProviders(list: readonly string[]): string[] {
  const next = normalizeTrustedProviders(list);
  trustedProviders.value = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Приватный режим браузера: список живёт до перезагрузки.
  }
  return next;
}

/** Разобрать многострочный ввод: строка — одна запись. */
export function parseTrustedProvidersInput(text: string): string[] {
  return normalizeTrustedProviders(text.split(/[\n,;]+/));
}
