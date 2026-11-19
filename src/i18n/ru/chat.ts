import type { LocaleMessages } from "../types";

export const chatMessages = {
  "chat.agent": "Агент",
  "chat.selectAgent": "— выберите —",
  "chat.newDialog": "Новый диалог",
  "chat.dialogs": "Диалоги",
  "chat.selectOrCreate": "Выберите или создайте диалог",
  "chat.messagesEmpty": "Сообщений пока нет.",
  "chat.composerPlaceholder": "Сообщение… (Enter — отправить)",
  "chat.send": "Отправить",
  "chat.usage": "{used} / {limit} вызовов сегодня",
  "chat.remaining": "Осталось вызовов сегодня: {remaining}",
  "chat.error.chooseAgent": "Выберите агента",
  "chat.error.noSession": "Сначала создайте или откройте сессию",
  "chat.error.agentNotFound": "Агент сессии не найден",
  "chat.error.noKey": "У агента не задан ключ. Введите его в разделе «Подключения».",
  "chat.error.limitReached": "Дневной лимит {limit} вызовов исчерпан. Счётчик обнулится завтра (UTC).",
  "chat.newDialogTitle": "Новый диалог",
  "chat.role.user": "вы",
  "chat.role.assistant": "агент",
  "chat.role.system": "система",
} as const satisfies LocaleMessages;
