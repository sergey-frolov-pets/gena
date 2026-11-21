/**
 * Ключи и снимки, которые чат хранит в localStorage.
 * Имена ключей не меняются: уже записанные черновики остаются на месте.
 */

import type { PendingTurn } from "@/lib/resume";

export const DRAFT_PREFIX = "gena.chat.draft.";
export const PENDING_KEY = "gena.chat.pending";
export const MAX_PENDING = 5;
export const FEED_WINDOW = 80;
export const TABS_STORAGE_KEY = "gena.chat.tabs";
export const TABS_HIDDEN_KEY = "gena.chat.tabs.hidden";
export const AGENT_STORAGE_KEY = "gena.chat.agent";

export interface TextStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function draftKey(id: string | null): string {
  return `${DRAFT_PREFIX}${id ?? "new"}`;
}

export function readStoredText(storage: Pick<TextStore, "getItem">, key: string): string {
  try {
    return storage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function writeStoredText(storage: TextStore, key: string, value: string): void {
  try {
    if (value) storage.setItem(key, value);
    else storage.removeItem(key);
  } catch {
    // Приватный режим или отключённое хранилище — живём без сохранения.
  }
}

export function parsePending(raw: string | null): PendingTurn[] {
  try {
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list.filter(
      (item): item is PendingTurn =>
        Boolean(item) &&
        typeof (item as PendingTurn).sessionId === "string" &&
        typeof (item as PendingTurn).text === "string" &&
        typeof (item as PendingTurn).at === "number",
    );
  } catch {
    return [];
  }
}

export function rememberPending(list: PendingTurn[], turn: PendingTurn): PendingTurn[] {
  if (list.some((item) => item.sessionId === turn.sessionId && item.text === turn.text)) {
    return list;
  }
  return [...list, turn].slice(-MAX_PENDING);
}

export function forgetPending(list: PendingTurn[], sessionId: string, text: string): PendingTurn[] {
  return list.filter((item) => !(item.sessionId === sessionId && item.text === text));
}

export function pendingFor(list: PendingTurn[], sessionId: string): PendingTurn | null {
  const matched = list.filter((item) => item.sessionId === sessionId);
  return matched.length > 0 ? matched[matched.length - 1] : null;
}
