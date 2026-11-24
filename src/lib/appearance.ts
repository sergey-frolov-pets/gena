/**
 * Шрифт, размер и ширина колонки диалога.
 *
 * Значения живут в localStorage и сразу попадают в CSS на <html>:
 * размер — через font-size (все rem масштабируются вместе с ним),
 * гарнитура — --ui-font, ширина чата на широком экране — --chat-width.
 */

import { ref, watch } from "vue";

export type AppFont = "system" | "serif" | "mono";

export const FONT_OPTIONS: AppFont[] = ["system", "serif", "mono"];
export const FONT_SIZES = [14, 15, 16, 17, 18, 20] as const;

export const DEFAULT_FONT: AppFont = "system";
export const DEFAULT_FONT_SIZE = 16;
export const DEFAULT_CHAT_WIDTH = 960;
export const CHAT_WIDTH_MIN = 640;
export const CHAT_WIDTH_MAX = 1600;

const STORAGE_FONT = "gena-font";
const STORAGE_FONT_SIZE = "gena-font-size";
const STORAGE_CHAT_WIDTH = "gena-chat-width";

const FONT_STACK: Record<AppFont, string> = {
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'Georgia, "Iowan Old Style", "Palatino Linotype", Palatino, serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Приватный режим: выбор действует до закрытия вкладки.
  }
}

export function isAppFont(value: string): value is AppFont {
  return (FONT_OPTIONS as string[]).includes(value);
}

export function readInitialFont(): AppFont {
  const saved = readStorage(STORAGE_FONT);
  return saved && isAppFont(saved) ? saved : DEFAULT_FONT;
}

export function readInitialFontSize(): number {
  const saved = Number(readStorage(STORAGE_FONT_SIZE));
  return (FONT_SIZES as readonly number[]).includes(saved) ? saved : DEFAULT_FONT_SIZE;
}

export function readInitialChatWidth(): number {
  const saved = Number(readStorage(STORAGE_CHAT_WIDTH));
  if (!Number.isFinite(saved)) return DEFAULT_CHAT_WIDTH;
  return Math.min(CHAT_WIDTH_MAX, Math.max(CHAT_WIDTH_MIN, Math.round(saved)));
}

const font = ref<AppFont>(readInitialFont());
const fontSize = ref(readInitialFontSize());
const chatWidth = ref(readInitialChatWidth());

function apply(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.fontSize = `${fontSize.value}px`;
  root.style.setProperty("--ui-font", FONT_STACK[font.value]);
  root.style.setProperty("--chat-width", `${chatWidth.value}px`);
}

watch([font, fontSize, chatWidth], () => {
  writeStorage(STORAGE_FONT, font.value);
  writeStorage(STORAGE_FONT_SIZE, String(fontSize.value));
  writeStorage(STORAGE_CHAT_WIDTH, String(chatWidth.value));
  apply();
}, { immediate: true });

export function useAppearance() {
  function setFont(value: AppFont): void {
    font.value = value;
  }
  function setFontSize(value: number): void {
    if ((FONT_SIZES as readonly number[]).includes(value)) fontSize.value = value;
  }
  function setChatWidth(value: number): void {
    chatWidth.value = Math.min(CHAT_WIDTH_MAX, Math.max(CHAT_WIDTH_MIN, Math.round(value)));
  }
  return { font, fontSize, chatWidth, setFont, setFontSize, setChatWidth };
}
