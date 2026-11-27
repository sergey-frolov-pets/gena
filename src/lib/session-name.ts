/**
 * Название диалога в модалке переименования.
 *
 * Вынесено из компонента, чтобы проверять без DOM: в проекте тесты на vitest
 * без @vue/test-utils, проще держать правило отдельной чистой функцией.
 */

/** Название без хвостовых пробелов и двойных пробелов внутри. */
export function normalizeSessionName(draft: string): string {
  return draft.trim().replace(/\s+/g, " ");
}

/**
 * Можно ли сохранить ввод.
 *
 * Пустое название бессмысленно (диалог станет безымянным), а неизменённое —
 * лишний запрос: кнопка «Переименовать» неактивна, Enter ничего не делает.
 */
export function canRenameSession(draft: string, current: string): boolean {
  const next = normalizeSessionName(draft);
  return next.length > 0 && next !== normalizeSessionName(current);
}
