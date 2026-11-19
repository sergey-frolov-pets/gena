import type { LocaleMessages } from "../types";

export const appMessages = {
  "app.name": "Gena",
  "app.tagline": "Mensajero sin servidor para agentes de IA",
  "app.language": "Idioma",
  "app.theme.toggle": "Cambiar tema",
  "app.theme.light": "Claro",
  "app.theme.dark": "Oscuro",
  "app.nav.connections": "Conexiones",
  "app.nav.chat": "Chat",
  "app.nav.sessions": "Sesiones",
  "app.nav.main": "Navegación principal",
} as const satisfies LocaleMessages;
