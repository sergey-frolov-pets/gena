/**
 * Режим приватности подключения.
 *
 * `tokens`  — диалоги этого агента всегда защищённые, снять защиту из чата нельзя.
 * `trusted` — разрешено отправлять открытый текст, но только провайдеру из списка
 *             доверенных; иначе агент ведёт себя как `tokens` (тихий откат).
 * `auto`    — открытый текст разрешён, но перед отправкой показываются автоподсказки
 *             найденных сущностей (этап M3); провайдер из списка — обязательное условие.
 *
 * Старое поле `tokenOnly` никуда не делось: записи, созданные до M2, читаются как
 * `tokens`, а отсутствие обоих полей — как `trusted` в режиме совместимости
 * (агент уже работал открытым текстом, задним числом поведение не меняем).
 */

import type { PrivacyMode } from "@/storage/types";

/** Все допустимые режимы — для схемы и UI. */
export const PRIVACY_MODES: readonly PrivacyMode[] = ["trusted", "tokens", "auto"];

interface PrivacyCarrier {
  privacy?: PrivacyMode;
  tokenOnly?: boolean;
  address?: string;
}

export function isPrivacyMode(value: unknown): value is PrivacyMode {
  return typeof value === "string" && (PRIVACY_MODES as readonly string[]).includes(value);
}

/** Режим подключения. Старый флаг `tokenOnly` сильнее нового поля. */
export function resolvePrivacyMode(agent?: PrivacyCarrier | null): PrivacyMode {
  if (agent?.tokenOnly === true) return "tokens";
  const mode = agent?.privacy;
  return isPrivacyMode(mode) ? mode : "trusted";
}

/** Агент создан до M2: режим не выбран, работаем по прежним правилам. */
export function isLegacyPrivacy(agent?: PrivacyCarrier | null): boolean {
  return !isPrivacyMode(agent?.privacy);
}

/** Хост из адреса агента; пустая строка, если адрес не разбирается. */
export function providerHost(address: string | undefined): string {
  const raw = (address ?? "").trim();
  if (!raw) return "";
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Запись списка доверенных: `api.example.com` — ровно этот хост,
 * `.example.com` или `*.example.com` — он сам и все поддомены.
 */
export function isTrustedProvider(address: string | undefined, trusted: readonly string[]): boolean {
  const host = providerHost(address);
  if (!host) return false;
  return trusted.some((raw) => {
    const entry = raw.trim().toLowerCase();
    if (!entry) return false;
    if (entry.startsWith("*.")) {
      const base = entry.slice(2);
      return host === base || host.endsWith(`.${base}`);
    }
    if (entry.startsWith(".")) {
      const base = entry.slice(1);
      return host === base || host.endsWith(`.${base}`);
    }
    return host === entry;
  });
}

/** Привести список к сравнимому виду: без пустых, с дедупликацией и нижним регистром. */
export function normalizeTrustedProviders(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const value = String(item ?? "").trim().toLowerCase();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** Что показать рядом с подключением. */
export type PrivacyBadge = "tokens" | "auto" | "trusted" | "untrusted" | "legacy";

export function privacyBadge(
  agent: PrivacyCarrier | null | undefined,
  trusted: readonly string[],
): PrivacyBadge {
  const mode = resolvePrivacyMode(agent);
  if (mode === "tokens") return "tokens";
  if (isLegacyPrivacy(agent)) return "legacy";
  if (!isTrustedProvider(agent?.address, trusted)) return "untrusted";
  return mode === "auto" ? "auto" : "trusted";
}
