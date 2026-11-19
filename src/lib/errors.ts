/**
 * Человекочитаемые сообщения об ошибках для UI.
 *
 * Задача — не показывать пользователю «агент ответил 429» или
 * «Failed to fetch», а объяснить, что случилось и что делать.
 *
 * Все тексты берутся из i18n: функция принимает переводчик `t`,
 * поэтому сообщение зависит от выбранного языка.
 */

import { AgentClientError } from "@/lib/agent-client";
import { AgentKeyCipherError } from "@/crypto/agent-key-cipher";
import { translateForLocale } from "@/i18n";
import { DEFAULT_LOCALE } from "@/i18n/constants";
import type { LocaleKey, TranslateFn } from "@/i18n/types";

/** Перевод по умолчанию (английский) — для вызовов без UI-контекста. */
const tDefault: TranslateFn = (key, params) => translateForLocale(DEFAULT_LOCALE, key, params);

/** Понятный текст для HTTP-статуса ответа агента. */
export function describeStatus(status: number, t: TranslateFn = tDefault): string {
  if (status === 400) return t("errors.status.400");
  if (status === 401 || status === 403) return t("errors.status.401");
  if (status === 404) return t("errors.status.404");
  if (status === 408) return t("errors.status.408");
  if (status === 413) return t("errors.status.413");
  if (status === 429) return t("errors.status.429");
  if (status >= 500) return t("errors.status.5xx", { status });
  return t("errors.status.other", { status });
}

/** Понятный текст для сетевой ошибки fetch (CORS, offline, DNS). */
export function describeNetworkError(error: unknown, t: TranslateFn = tDefault): string {
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();
  if (lower.includes("cors") || lower.includes("cross-origin")) {
    return t("errors.network.cors");
  }
  if (lower.includes("failed to fetch") || lower.includes("networkerror")) {
    return t("errors.network.unreachable");
  }
  if (lower.includes("abort") || lower.includes("timeout")) {
    return t("errors.network.aborted");
  }
  return t("errors.network.other", { raw });
}

/** Понятный текст для ошибки шифрования ключа. */
export function describeCipherError(error: AgentKeyCipherError, t: TranslateFn = tDefault): string {
  if (error.code === "missing_seed") {
    return t("errors.cipher.missingSeed");
  }
  return t("errors.cipher.decryptFailed");
}

/** Универсальный маппер: любая ошибка → текст для пользователя. */
export function describeError(error: unknown, t: TranslateFn = tDefault): string {
  if (error instanceof AgentKeyCipherError) {
    return describeCipherError(error, t);
  }
  if (error instanceof AgentClientError) {
    if (typeof error.status === "number") {
      return describeStatus(error.status, t);
    }
    const byCode: Partial<Record<string, LocaleKey>> = {
      no_address: "errors.client.noAddress",
      not_json: "errors.client.notJson",
      no_reply: "errors.client.noReply",
    };
    if (error.code && byCode[error.code]) {
      return t(byCode[error.code] as LocaleKey);
    }
    // Сетевая ошибка: detail — сырой текст fetch, если он есть.
    return describeNetworkError(new Error(error.detail ?? error.message), t);
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
