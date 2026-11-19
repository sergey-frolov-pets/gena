/**
 * Тема интерфейса (светлая/тёмная).
 *
 * Выбор хранится в localStorage. По умолчанию — тёмная (как раньше).
 * Тема применяется через `data-theme` на `<html>` и `color-scheme`.
 */

import { ref, watch } from "vue";

export type Theme = "light" | "dark";

export const DEFAULT_THEME: Theme = "dark";
export const STORAGE_KEY_THEME = "gena-theme";

export function isTheme(value: string): value is Theme {
  return value === "light" || value === "dark";
}

function readStorage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY_THEME);
  } catch {
    return null;
  }
}

function writeStorage(value: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY_THEME, value);
  } catch {
    // Приватный режим: тема просто не запоминается между визитами.
  }
}

export function readInitialTheme(): Theme {
  const saved = readStorage();
  if (saved && isTheme(saved)) {
    return saved;
  }
  return DEFAULT_THEME;
}

const theme = ref<Theme>(readInitialTheme());

function applyDocumentTheme(value: Theme): void {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.dataset.theme = value;
  document.documentElement.style.colorScheme = value;
}

watch(
  theme,
  (value) => {
    writeStorage(value);
    applyDocumentTheme(value);
  },
  { immediate: true },
);

export function useTheme() {
  function setTheme(value: Theme): void {
    theme.value = value;
  }

  function toggle(): void {
    theme.value = theme.value === "dark" ? "light" : "dark";
  }

  return { theme, setTheme, toggle };
}
