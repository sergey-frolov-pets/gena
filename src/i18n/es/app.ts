import type { LocaleMessages } from "../types";

export const appMessages = {
  "app.name": "Gena",
  "app.tagline": "Mensajero sin servidor para agentes de IA",
  "app.language": "Idioma",
  "app.nav.connections": "Conexiones",
  "app.nav.chat": "Chat",
  "app.nav.sessions": "Sesiones",
  "app.nav.main": "Navegación principal",
} as const satisfies LocaleMessages;
