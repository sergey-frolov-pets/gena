import type { LocaleMessages } from "../types";

export const connectionsMessages = {
  "connections.title": "Подключения к агентам",
  "connections.intro":
    "Ключ агента хранится в браузере зашифрованным (AES-GCM, ключ на устройстве). В бэкап ключи не попадают.",
  "connections.newAgent": "Новый агент",
  "connections.field.name": "Имя",
  "connections.field.namePlaceholder": "Мой агент",
  "connections.field.address": "Адрес (URL endpoint)",
  "connections.field.addressPlaceholder": "https://agent.example.com/chat",
  "connections.field.key": "Ключ (Bearer token)",
  "connections.field.keyPlaceholder": "секрет",
  "connections.field.contextSize": "Размер контекста (сообщений)",
  "connections.field.callLimit": "Лимит вызовов в сутки (0 — без лимита)",
  "connections.field.llmModel": "LLM-модель",
  "connections.field.llmModelPlaceholder": "напр. gpt-4o-mini",
  "connections.add": "Добавить",
  "connections.added": "Агент добавлен",
  "connections.missingFields": "Укажите имя и адрес агента",
  "connections.list": "Список агентов",
  "connections.empty": "Пока нет агентов.",
  "connections.remove": "Удалить",
  "connections.summary": "контекст: {contextSize} · лимит/сутки: {callLimit} · модель: {model}",
  "connections.keySaved": "ключ сохранён — введите новый, чтобы заменить",
  "connections.keyMissing": "ключ не задан",
  "connections.saveKey": "Сохранить ключ",
  "connections.keyUpdated": "Ключ обновлён",
} as const satisfies LocaleMessages;
