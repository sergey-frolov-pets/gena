import type { LocaleMessages } from "../types";

export const appMessages = {
  "app.name": "Gena",
  "app.tagline": "ماسنجر بلا خادم لوكلاء الذكاء الاصطناعي",
  "app.language": "اللغة",
  "app.theme.toggle": "تبديل المظهر",
  "app.theme.light": "فاتح",
  "app.theme.dark": "داكن",
  "app.nav.connections": "الاتصالات",
  "app.nav.chat": "الدردشة",
  "app.nav.sessions": "الجلسات",
  "app.nav.main": "التنقل الرئيسي",
} as const satisfies LocaleMessages;
