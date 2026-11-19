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
  "app.install": "Instalar",
  "app.footer.license": "Licencia",
  "app.footer.support": "Apoyar el proyecto",
  "app.footer.versionHint": "Versión",
  "app.footer.links": "Enlaces del pie de página",
} as const satisfies LocaleMessages;
