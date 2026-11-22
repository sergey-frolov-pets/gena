import type { LocaleMessages } from "../types";
import { appMessages } from "./app";
import { chatMessages } from "./chat";
import { connectionsMessages } from "./connections";
import { errorsMessages } from "./errors";
import { sessionsMessages } from "./sessions";
import { tokensByLocale } from "../tokens";

export const ruMessages = {
  ...appMessages,
  ...connectionsMessages,
  ...chatMessages,
  ...sessionsMessages,
  ...errorsMessages,
  ...tokensByLocale.ru,
} as const satisfies LocaleMessages;
