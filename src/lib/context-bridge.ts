/**
 * Мост контекста: передача сессий и проектов в другой диалог.
 *
 * Чипы в композере — это ссылки на источник (сессия или проект) и режим
 * передачи (полный текст или саммари). Здесь только чистые функции:
 * сборка блока-преамбулы, лимит размера, ключи чипов. Сеть и хранилище —
 * в `summary.ts` и `projects.ts`.
 */

import type { CachedSummary } from "@/storage/types";

export type ContextSourceKind = "session" | "project";
export type ContextMode = "full" | "summary";

/** Сколько символов контекста уходит агенту за один ход. */
export const CONTEXT_LIMIT = 40_000;

/** Сколько символов источника уходит в саммари (весь диалог целиком дорого). */
export const SUMMARY_SOURCE_LIMIT = 120_000;

export interface ContextChip {
  /** Стабильный ключ чипа: один источник может быть приложен и целиком, и саммари. */
  key: string;
  kind: ContextSourceKind;
  mode: ContextMode;
  /** Локальный id сессии или проекта. */
  id: string;
  title: string;
  /** Готовое саммари, если оно уже считалось (у проектов приходит с сервера). */
  summary?: CachedSummary;
  /** Источник на сервере: нужно, чтобы саммари сохранилось для других устройств. */
  serverId?: string;
  remoteId?: string;
  /** Число сообщений — показываем в подсказке чипа. */
  messageCount?: number;
}

export function chipKey(kind: ContextSourceKind, id: string, mode: ContextMode): string {
  return `${kind}:${id}:${mode}`;
}

export function makeChip(input: Omit<ContextChip, "key">): ContextChip {
  return { ...input, key: chipKey(input.kind, input.id, input.mode) };
}

/** Саммари годится без пересчёта: есть текст и сервер не пометил его устаревшим. */
export function summaryUsable(chip: ContextChip): boolean {
  const text = chip.summary?.text?.trim();
  if (!text) return false;
  return !chip.summary?.stale;
}

export interface ContextPart {
  kind: ContextSourceKind;
  mode: ContextMode;
  title: string;
  /** Текст: саммари либо полный диалог в markdown. */
  body: string;
  /** Для проекта в режиме полного текста — сколько сессий вошло. */
  sessionCount?: number;
}

const HEADER = [
  "## Контекст из других диалогов",
  "",
  "Ниже — материал из других диалогов пользователя, приложенный к текущему вопросу.",
  "Это справка о прошлом: используй факты, решения и цифры оттуда,",
  "но не пересказывай сам контекст, если не просят.",
  "",
].join("\n");

/** Обрезает текст по границе слова и помечает обрезку. */
export function truncateContext(text: string, limit = CONTEXT_LIMIT): { text: string; truncated: boolean } {
  const value = String(text ?? "");
  if (value.length <= limit) return { text: value, truncated: false };
  const cut = value.slice(0, Math.max(0, limit - 80));
  const at = cut.lastIndexOf("\n");
  const body = at > limit * 0.6 ? cut.slice(0, at) : cut;
  return { text: `${body.trimEnd()}\n\n_…контекст обрезан: не поместился целиком._`, truncated: true };
}

function partHeading(part: ContextPart): string {
  const label = part.kind === "project" ? "Проект" : "Диалог";
  const mode =
    part.mode === "summary"
      ? "саммари"
      : part.sessionCount && part.sessionCount > 1
        ? `полный текст, ${part.sessionCount} сессий`
        : "полный текст";
  return `### ${label} «${part.title || "без названия"}» — ${mode}`;
}

/**
 * Блок-преамбула для агента. Пустой список частей — пустая строка:
 * вызывающий код не должен добавлять заголовок «Контекст» без контекста.
 */
export function buildContextBlock(parts: ContextPart[]): string {
  const usable = parts.filter((part) => part.body.trim().length > 0);
  if (usable.length === 0) return "";
  const sections = usable.map((part) => `${partHeading(part)}\n\n${part.body.trim()}`);
  const joined = `${HEADER}${sections.join("\n\n")}`;
  return truncateContext(joined).text;
}

/**
 * Текст пользователя вместе с контекстом. Контекст идёт первым: агент видит
 * его до вопроса и не путает с текущей репликой.
 */
export function composeMessage(text: string, parts: ContextPart[]): string {
  const block = buildContextBlock(parts);
  if (!block) return text;
  return `${block}\n\n---\n\n${text}`;
}

/** Короткая подпись чипа: «Пенсия · саммари». */
export function chipLabel(chip: ContextChip): string {
  const suffix = chip.mode === "summary" ? "саммари" : "полный";
  return `${chip.title || "без названия"} · ${suffix}`;
}
