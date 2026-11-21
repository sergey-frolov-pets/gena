/**
 * Контракт UI-блока Gena (v1).
 *
 * Агент присылает обычный текст, а в конце — ограждённый блок `gena-ui`
 * с JSON-описанием карточки. Клиент вырезает блок из текста и (с P1) рисует
 * по нему компонент; старый клиент просто видит текст.
 *
 * Правила (docs/plan-plugins-20261120.md):
 *  - блок один на сообщение и всегда последний;
 *  - `content` в хранилище не меняется — вырезаем только на выдаче;
 *  - невалидный блок → тихий fallback в обычный текст.
 */

/** Ограждение блока в markdown-тексте сообщения. */
export const UI_FENCE = "gena-ui";
/** Версия схемы, которую понимает этот клиент. */
export const UI_SCHEMA_VERSION = 1;
/** Предел размера JSON-блока (решение Сергея: 16 КБ, не 64). */
export const MAX_BLOCK_BYTES = 16 * 1024;
export const MAX_ITEMS = 200;
export const MAX_GROUPS = 12;
export const MAX_ACTIONS = 12;
export const MAX_STRING = 2000;
export const MAX_TITLE = 120;
export const MAX_BADGES = 4;
export const MAX_META = 8;
export const MAX_SEND = 300;

/**
 * Плагины, которые клиент умеет рисовать. Неизвестный плагин — это fallback
 * в текст, чтобы новая карточка не сломала старую сборку.
 */
export { KNOWN_PLUGINS } from "./registry";

export type UiView = "list" | "table" | "board" | "card" | "markdown";
export type ActionScope = "item" | "view";
export type ActionStyle = "primary" | "ghost" | "danger";
export type Optimistic = "remove" | "check" | "disable";

/** Кнопка под карточкой: отправляет агенту текст из `send`. */
export interface UiAction {
  id: string;
  label: string;
  scope: ActionScope;
  /** Шаблон реплики: `{id}`, `{title}`, `{status}`, `{value}`. */
  send: string;
  style?: ActionStyle;
  /** Спросить подтверждение (ConfirmModal) перед отправкой. */
  confirm?: boolean;
  /** Реплику не показывать в ленте («тихая» отправка). */
  hidden?: boolean;
  /** Локальный отклик до ответа агента. */
  optimistic?: Optimistic;
}

export interface UiMeta {
  label: string;
  value: string;
}

export interface UiItem {
  id: string;
  title: string;
  subtitle?: string;
  status?: string;
  due?: string;
  badges?: string[];
  meta?: UiMeta[];
  checked?: boolean;
  disabled?: boolean;
  /** Внешняя ссылка, только http/https. */
  url?: string;
}

export interface UiGroup {
  key: string;
  label: string;
  items: UiItem[];
}

export interface UiData {
  view?: UiView;
  items?: UiItem[];
  groups?: UiGroup[];
  markdown?: string;
  empty?: string;
}

export interface UiBlock {
  v: number;
  plugin: string;
  title?: string;
  data: UiData;
  actions: UiAction[];
}

/** Почему блок не принят — код уходит в лог, пользователю не показывается. */
export type UiIssueCode =
  | "bad-json"
  | "bad-shape"
  | "bad-version"
  | "unknown-plugin"
  | "too-large"
  | "block-not-last"
  | "extra-blocks";

export interface UiIssue {
  code: UiIssueCode;
  detail?: string;
}

export interface UiParts {
  /** Текст сообщения без блока (или как есть, если блок не принят). */
  text: string;
  /** Принятый блок или null. */
  block: UiBlock | null;
  /** Диагностика: уходит в лог, не в UI. */
  issues: UiIssue[];
}
