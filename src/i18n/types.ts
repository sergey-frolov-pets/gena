import { enMessages } from "./en";

/** Плоский словарь ключ → текст. */
export type LocaleMessages = Record<string, string>;

/** Ключи берутся из английского словаря: остальные языки обязаны его покрывать. */
export type LocaleKey = Extract<keyof typeof enMessages, string>;

export type TranslateFn = (key: LocaleKey, params?: Record<string, string | number>) => string;

export function isLocaleKey(key: string): key is LocaleKey {
  return Object.prototype.hasOwnProperty.call(enMessages, key);
}
