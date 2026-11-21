/**
 * Реестр карточек gena-ui.
 * Новый плагин — строка здесь. Неизвестный id остаётся текстом резюме.
 */

export interface UiPlugin {
  id: string;
}

export const UI_PLUGINS: readonly UiPlugin[] = [
  { id: "ozadachnik.tasks" },
  { id: "backlog.board" },
  { id: "notes.doc" },
];

export const KNOWN_PLUGINS: ReadonlySet<string> = new Set(UI_PLUGINS.map((plugin) => plugin.id));

export function isKnownPlugin(id: string): boolean {
  return KNOWN_PLUGINS.has(id);
}
