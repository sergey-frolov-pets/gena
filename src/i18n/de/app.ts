import type { LocaleMessages } from "../types";

export const appMessages = {
  "app.name": "Gena",
  "app.tagline": "Serverloser Messenger für KI-Agenten",
  "app.language": "Sprache",
  "app.theme.toggle": "Design wechseln",
  "app.theme.light": "Hell",
  "app.theme.dark": "Dunkel",
  "app.nav.connections": "Verbindungen",
  "app.nav.chat": "Chat",
  "app.nav.sessions": "Sitzungen",
  "app.nav.main": "Hauptnavigation",
} as const satisfies LocaleMessages;
