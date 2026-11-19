import type { LocaleMessages } from "../types";

export const appMessages = {
  "app.name": "Gena",
  "app.tagline": "Мессенджер для ИИ-агентов без бэкенда",
  "app.language": "Язык",
  "app.theme.toggle": "Переключить тему",
  "app.theme.light": "Светлая",
  "app.theme.dark": "Тёмная",
  "app.nav.connections": "Подключения",
  "app.nav.chat": "Чат",
  "app.nav.sessions": "Сессии",
  "app.nav.main": "Основная навигация",
} as const satisfies LocaleMessages;
