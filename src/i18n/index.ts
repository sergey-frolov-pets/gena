/**
 * Реактивный язык интерфейса.
 *
 * Выбор хранится в localStorage. При первом запуске берётся язык браузера,
 * если он поддерживается, иначе — английский. Смена языка обновляет
 * `<html lang>` и `<html dir>` (арабский — RTL).
 */

import { ref, watch } from "vue";
import {
  DEFAULT_LOCALE,
  isAppLocale,
  localeDirection,
  STORAGE_KEY_LOCALE,
  type AppLocale,
} from "./constants";
import { formatMessage, messagesByLocale } from "./messages";
import type { LocaleKey, TranslateFn } from "./types";

export function translateForLocale(
  locale: AppLocale,
  key: LocaleKey,
  params?: Record<string, string | number>,
): string {
  const template = messagesByLocale[locale][key] ?? messagesByLocale[DEFAULT_LOCALE][key] ?? key;
  return formatMessage(template, params);
}

function readStorage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY_LOCALE);
  } catch {
    return null;
  }
}

function writeStorage(value: AppLocale): void {
  try {
    localStorage.setItem(STORAGE_KEY_LOCALE, value);
  } catch {
    // Приватный режим: язык просто не запоминается между визитами.
  }
}

export function readInitialLocale(): AppLocale {
  const saved = readStorage();
  if (saved && isAppLocale(saved)) {
    return saved;
  }

  const browserLang =
    typeof navigator !== "undefined" ? navigator.language.slice(0, 2).toLowerCase() : "";
  if (isAppLocale(browserLang)) {
    return browserLang;
  }

  return DEFAULT_LOCALE;
}

const locale = ref<AppLocale>(readInitialLocale());

function applyDocumentLocale(value: AppLocale): void {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.lang = value;
  document.documentElement.dir = localeDirection(value);
}

watch(
  locale,
  (value) => {
    writeStorage(value);
    applyDocumentLocale(value);
  },
  { immediate: true },
);

export function useLocale() {
  const t: TranslateFn = (key, params) => translateForLocale(locale.value, key, params);

  function setLocale(value: AppLocale): void {
    locale.value = value;
  }

  return { locale, setLocale, t };
}
