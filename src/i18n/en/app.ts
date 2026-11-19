import type { LocaleMessages } from "../types";

export const appMessages = {
  "app.name": "Gena",
  "app.tagline": "Serverless messenger for AI agents",
  "app.language": "Language",
  "app.nav.connections": "Connections",
  "app.nav.chat": "Chat",
  "app.nav.sessions": "Sessions",
  "app.nav.main": "Main navigation",
} as const satisfies LocaleMessages;
