/**
 * Поддерживаемые языки интерфейса.
 *
 * Набор совпадает с code2graph: en, ru, es, zh, ja, hi, pt, de, ar.
 * Язык по умолчанию — английский; арабский — RTL.
 */

export const SUPPORTED_LOCALES = ["en", "ru", "es", "zh", "ja", "hi", "pt", "de", "ar"] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "en";

export const STORAGE_KEY_LOCALE = "gena-locale";

const RTL_LOCALES = ["ar"] as const satisfies readonly AppLocale[];

export function isAppLocale(value: string): value is AppLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function localeDirection(locale: AppLocale): "ltr" | "rtl" {
  return (RTL_LOCALES as readonly AppLocale[]).includes(locale) ? "rtl" : "ltr";
}

/** Названия языков на самом языке — для переключателя. */
export const LOCALE_LABELS: Record<AppLocale, string> = {
  en: "English",
  ru: "Русский",
  es: "Español",
  zh: "中文",
  ja: "日本語",
  hi: "हिन्दी",
  pt: "Português",
  de: "Deutsch",
  ar: "العربية",
};
