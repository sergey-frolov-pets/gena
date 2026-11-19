import type { LocaleMessages } from "../types";
import { appMessages } from "./app";
import { chatMessages } from "./chat";
import { connectionsMessages } from "./connections";
import { errorsMessages } from "./errors";
import { sessionsMessages } from "./sessions";

export const zhMessages = {
  ...appMessages,
  ...connectionsMessages,
  ...chatMessages,
  ...sessionsMessages,
  ...errorsMessages,
} as const satisfies LocaleMessages;
