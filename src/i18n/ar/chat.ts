import type { LocaleMessages } from "../types";

export const chatMessages = {
  "chat.agent": "الوكيل",
  "chat.selectAgent": "— اختر —",
  "chat.newDialog": "حوار جديد",
  "chat.dialogs": "الحوارات",
  "chat.selectOrCreate": "اختر حوارًا أو أنشئ واحدًا",
  "chat.messagesEmpty": "لا توجد رسائل بعد.",
  "chat.composerPlaceholder": "رسالة… (Enter للإرسال)",
  "chat.send": "إرسال",
  "chat.usage": "{used} / {limit} استدعاء اليوم",
  "chat.remaining": "الاستدعاءات المتبقية اليوم: {remaining}",
  "chat.error.chooseAgent": "اختر وكيلًا",
  "chat.error.noSession": "أنشئ جلسة أو افتحها أولًا",
  "chat.error.agentNotFound": "لم يُعثر على وكيل الجلسة",
  "chat.error.noKey": "لا يوجد مفتاح لهذا الوكيل. أدخله في «الاتصالات».",
  "chat.error.limitReached": "تم استنفاد الحد اليومي {limit} استدعاء. يُعاد ضبط العدّاد غدًا (UTC).",
  "chat.newDialogTitle": "حوار جديد",
  "chat.role.user": "المستخدم",
  "chat.role.assistant": "المساعد",
  "chat.role.system": "النظام",
} as const satisfies LocaleMessages;
