import type { LocaleMessages } from "../types";

export const connectionsMessages = {
  "connections.title": "اتصالات الوكيل",
  "connections.intro":
    "يُخزَّن مفتاح الوكيل مشفَّرًا في متصفحك (AES-GCM، ويبقى المفتاح على هذا الجهاز). لا تُدرَج المفاتيح في النسخ الاحتياطية أبدًا.",
  "connections.newAgent": "وكيل جديد",
  "connections.field.name": "الاسم",
  "connections.field.namePlaceholder": "وكيلي",
  "connections.field.address": "العنوان (URL endpoint)",
  "connections.field.addressPlaceholder": "https://agent.example.com/chat",
  "connections.field.key": "المفتاح (Bearer token)",
  "connections.field.keyPlaceholder": "سرّي",
  "connections.field.contextSize": "حجم السياق (الرسائل)",
  "connections.field.callLimit": "الحد اليومي للاستدعاءات (0 — بلا حد)",
  "connections.field.llmModel": "نموذج LLM",
  "connections.field.llmModelPlaceholder": "مثل gpt-4o-mini",
  "connections.add": "إضافة",
  "connections.added": "تمت إضافة الوكيل",
  "connections.missingFields": "أدخل اسم الوكيل وعنوانه",
  "connections.list": "الوكلاء",
  "connections.empty": "لا يوجد وكلاء بعد.",
  "connections.remove": "حذف",
  "connections.summary": "السياق: {contextSize} · الاستدعاءات/يوم: {callLimit} · النموذج: {model}",
  "connections.keySaved": "المفتاح محفوظ — أدخل مفتاحًا جديدًا لاستبداله",
  "connections.keyMissing": "لا يوجد مفتاح",
  "connections.saveKey": "حفظ المفتاح",
  "connections.keyUpdated": "تم تحديث المفتاح",
} as const satisfies LocaleMessages;
