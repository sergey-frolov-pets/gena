import type { LocaleMessages } from "../types";

export const sessionsMessages = {
  "sessions.title": "Сессии и данные",
  "sessions.selectAll": "Выбрать все",
  "sessions.deselectAll": "Снять все",
  "sessions.selected": "Выбрано: {count} из {total}",
  "sessions.empty": "Сессий нет.",
  "sessions.item": "· {agent} · {count} сообщ. · {date}",
  "sessions.backup.title": "Бэкап истории",
  "sessions.backup.intro":
    "Экспорт — открытый JSON. В файл не попадают ключи агентов и пароли: только сессии, сообщения и настройки агентов (адрес, модель, лимиты). Ключ агента после импорта вводится заново.",
  "sessions.backup.onlySelected": "Экспортировать только отмеченные сессии",
  "sessions.backup.export": "Экспорт в файл",
  "sessions.backup.import": "Импорт из файла",
  "sessions.backup.exported":
    "Экспортировано: {sessions} сессий, {messages} сообщений. Ключи агентов и пароли в файл не попадают.",
  "sessions.backup.imported":
    "Импорт (слияние): {parts}. Ключи существующих агентов сохранены; для новых агентов введите ключ.",
  "sessions.backup.importedAgents": "агентов: +{added} / обновлено {updated}",
  "sessions.backup.importedSessions": "сессий: +{added}",
  "sessions.backup.importedMessages": "сообщений: +{added}",
  "sessions.backup.importedSkipped": "пропущено конфликтов: {count}",
  "sessions.cleanup.title": "Очистка IndexedDB",
  "sessions.cleanup.exceptSelected": "Удалить всё, кроме отмеченных ({count})",
  "sessions.cleanup.removed": "Удалено: {sessions} сессий, {messages} сообщений. Сохранено {kept}.",
  "sessions.cleanup.confirmAll": "Подтверждаю удаление всех сессий",
  "sessions.cleanup.deleteAll": "Удалить все сессии",
  "sessions.cleanup.needConfirm": "Отметьте подтверждение, чтобы удалить всё",
  "sessions.cleanup.removedAll": "Удалено всё: {sessions} сессий, {messages} сообщений.",
  "sessions.cleanup.agentsKept": "Агенты при очистке сохраняются.",
} as const satisfies LocaleMessages;
