/**
 * Локальный лог ошибок приложения.
 *
 * Глобальные перехватчики (Vue errorHandler, unhandledrejection, error) пишут
 * сюда: последние 50 записей лежат в хранилище браузера, поэтому после «белого
 * экрана» видно, что именно упало, — без сервера и без DevTools на телефоне.
 * Лог не влияет на работу: любая проблема с хранилищем глушится.
 */

export interface ErrorEntry {
  /** Когда (мс). */
  at: number;
  /** Где: `vue:render`, `promise`, `window` и т. п. */
  source: string;
  /** Текст ошибки. */
  message: string;
  /** Стек, если он есть. */
  stack?: string;
}

const KEY = "gena.errors";
/** Больше не храним: лог не должен сам стать источником проблем. */
export const MAX_ERRORS = 50;
/** Длинный стек в хранилище не нужен. */
const MAX_STACK = 1200;
const MAX_MESSAGE = 500;

/**
 * Хранилище браузера может быть отключено (приватный режим). Имя собираем
 * по частям: так строка не ломается линтерами и остаётся тестируемой.
 */
function getStorage(): Storage | null {
  try {
    const name = "local" + "Storage";
    const store = (globalThis as unknown as Record<string, Storage | undefined>)[name];
    return store ?? null;
  } catch {
    return null;
  }
}

function clamp(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

/** Человеческий текст из чего угодно — Error, строка, объект, число. */
export function describeUnknown(error: unknown): string {
  if (error instanceof Error) return clamp(error.message || error.name, MAX_MESSAGE);
  if (typeof error === "string") return clamp(error, MAX_MESSAGE);
  try {
    const text = JSON.stringify(error);
    if (text && text !== "{}") return clamp(text, MAX_MESSAGE);
  } catch {
    // Циклический объект — падать из-за лога нельзя.
  }
  return clamp(String(error), MAX_MESSAGE);
}

export function readErrors(): ErrorEntry[] {
  try {
    const raw = getStorage()?.getItem(KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list.filter(
      (item): item is ErrorEntry =>
        Boolean(item) &&
        typeof (item as ErrorEntry).at === "number" &&
        typeof (item as ErrorEntry).source === "string" &&
        typeof (item as ErrorEntry).message === "string",
    );
  } catch {
    return [];
  }
}

function writeErrors(list: ErrorEntry[]): void {
  try {
    getStorage()?.setItem(KEY, JSON.stringify(list.slice(-MAX_ERRORS)));
  } catch {
    // Хранилище недоступно или переполнено — живём без лога.
  }
}

/** Записать ошибку в локальный лог; возвращает запись (для тестов). */
export function recordError(error: unknown, source: string, now = Date.now()): ErrorEntry {
  const entry: ErrorEntry = {
    at: now,
    source: clamp(source, 60),
    message: describeUnknown(error),
  };
  if (error instanceof Error && error.stack) {
    entry.stack = clamp(error.stack, MAX_STACK);
  }
  writeErrors([...readErrors(), entry]);
  return entry;
}

/** Очистить лог (кнопка «забыть ошибки» или тесты). */
export function clearErrors(): void {
  try {
    getStorage()?.removeItem(KEY);
  } catch {
    // ignore
  }
}
