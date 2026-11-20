import pathlib

# Новые ключи: локали, тексты (уведомление о новой сборке в service worker).
TEXTS = {
    "ru": ("Доступна новая версия", "Обновить"),
    "en": ("A new version is available", "Update"),
    "de": ("Eine neue Version ist verfügbar", "Aktualisieren"),
    "es": ("Hay una nueva versión disponible", "Actualizar"),
    "pt": ("Há uma nova versão disponível", "Atualizar"),
    "zh": ("有新版本可用", "更新"),
    "ja": ("新しいバージョンがあります", "更新"),
    "hi": ("नया संस्करण उपलब्ध है", "अपडेट करें"),
    "ar": ("يتوفر إصدار جديد", "تحديث"),
}

ROOT = pathlib.Path("src/i18n")

for locale, (ready, action) in TEXTS.items():
    path = ROOT / locale / "app.ts"
    text = path.read_text(encoding="utf-8")
    if "app.updateReady" in text:
        print(locale, "already")
        continue
    anchor = "} as const satisfies LocaleMessages;"
    if anchor not in text:
        print(locale, "ANCHOR MISSING")
        continue
    added = (
        f'  "app.updateReady": "{ready}",\n'
        f'  "app.updateAction": "{action}",\n'
    )
    text = text.replace(anchor, added + anchor)
    path.write_text(text, encoding="utf-8")
    print(locale, "ok")
