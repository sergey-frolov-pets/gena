/**
 * Теги диалогов: разбор ввода, хранение в записи сессии, фильтр.
 *
 * Чистые функции — их проверяет `session-tags.test.ts`; компоненты только рисуют.
 * Правила: до `MAX_TAGS` тегов на диалог, каждый до `MAX_TAG_LEN` символов,
 * повторы считаются одним тегом без учёта регистра (`Работа` = `работа`),
 * показывается первое написание.
 */

import type { Session } from "@/storage/types";

export const MAX_TAGS = 8;
export const MAX_TAG_LEN = 24;

/** Один тег: без ведущих `#`, без лишних пробелов, обрезан по длине. */
export function normalizeTag(value: string): string {
  const text = value
    .replace(/^#+/, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, MAX_TAG_LEN).trim();
}

/** Массив тегов: только строки, без пустых и повторов, не больше лимита. */
export function normalizeTags(values: readonly unknown[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values ?? []) {
    if (typeof raw !== "string") continue;
    const tag = normalizeTag(raw);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/** Ввод «работа, личное; дом» → массив тегов. */
export function parseTagsInput(text: string): string[] {
  return normalizeTags(text.split(/[,;\n]+/));
}

/** Обратно в строку для поля ввода. */
export function formatTagsInput(tags: readonly string[] | undefined): string {
  return (tags ?? []).join(", ");
}

/** Все теги, что есть у диалогов: для чипов фильтра. Порядок — по алфавиту. */
export function collectTags(sessions: readonly Session[]): string[] {
  const seen = new Map<string, string>();
  for (const session of sessions) {
    for (const tag of session.tags ?? []) {
      const key = tag.toLowerCase();
      if (!seen.has(key)) seen.set(key, tag);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** Есть ли у диалога такой тег; пустой тег пропускает всё. */
export function hasTag(session: Session, tag: string): boolean {
  const key = tag.trim().toLowerCase();
  if (!key) return true;
  return (session.tags ?? []).some((item) => item.toLowerCase() === key);
}

/** Список диалогов с выбранным тегом; пустой тег — без фильтра. */
export function filterByTag(list: readonly Session[], tag: string): Session[] {
  if (!tag.trim()) return [...list];
  return list.filter((session) => hasTag(session, tag));
}
