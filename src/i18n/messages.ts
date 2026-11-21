import type { AppLocale } from "./constants";
import { arMessages } from "./ar";
import { deMessages } from "./de";
import { enMessages } from "./en";
import { esMessages } from "./es";
import { hiMessages } from "./hi";
import { jaMessages } from "./ja";
import { ptMessages } from "./pt";
import { ruMessages } from "./ru";
import { zhMessages } from "./zh";
import type { LocaleKey, LocaleMessages } from "./types";

export type { LocaleMessages } from "./types";
export { isLocaleKey } from "./types";
export type { LocaleKey, TranslateFn } from "./types";

export {
  arMessages,
  deMessages,
  enMessages,
  esMessages,
  hiMessages,
  jaMessages,
  ptMessages,
  ruMessages,
  zhMessages,
};

/** Каждый словарь обязан содержать все английские ключи — иначе сборка не проходит. */
const catalogs: Record<AppLocale, { [K in LocaleKey]: string }> = {
  en: enMessages,
  ru: ruMessages,
  es: esMessages,
  zh: zhMessages,
  ja: jaMessages,
  hi: hiMessages,
  pt: ptMessages,
  de: deMessages,
  ar: arMessages,
};

export const messagesByLocale: Record<AppLocale, LocaleMessages> = catalogs;

/** Подстановка параметров вида `{name}` в шаблон. */
export function formatMessage(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = params[key];
    return value !== undefined ? String(value) : `{${key}}`;
  });
}
