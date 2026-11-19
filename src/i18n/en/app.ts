import type { LocaleMessages } from "../types";

export const appMessages = {
  "app.name": "Gena",
  "app.tagline": "Serverless messenger for AI agents",
  "app.language": "Language",
  "app.theme.toggle": "Toggle theme",
  "app.theme.light": "Light",
  "app.theme.dark": "Dark",
  "app.nav.connections": "Connections",
  "app.nav.chat": "Chat",
  "app.nav.sessions": "Sessions",
  "app.nav.main": "Main navigation",
  "app.install": "Install",
  "app.footer.license": "License",
  "app.footer.support": "Support the project",
  "app.footer.versionHint": "Version",
  "app.footer.links": "Footer links",
} as const satisfies LocaleMessages;
