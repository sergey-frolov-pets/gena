import type { LocaleMessages } from "../types";
import { appMessages } from "./app";
import { accessMessages } from "./access";
import { chatMessages } from "./chat";
import { connectionsMessages } from "./connections";
import { errorsMessages } from "./errors";
import { sessionsMessages } from "./sessions";
import { tokensByLocale } from "../tokens";

export const hiMessages = {
  ...appMessages,
  ...connectionsMessages,
  ...chatMessages,
  ...sessionsMessages,
  ...errorsMessages,
  ...tokensByLocale.hi,
  ...accessMessages,
} as const satisfies LocaleMessages;
