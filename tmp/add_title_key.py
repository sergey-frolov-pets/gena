import io
import re
import pathlib

VALUES = {
    "ru": "Название диалога",
    "en": "Dialog title",
    "de": "Dialogname",
    "es": "Nombre del diálogo",
    "pt": "Nome do diálogo",
    "zh": "对话名称",
    "ja": "ダイアログ名",
    "hi": "डायलॉग का नाम",
    "ar": "اسم الحوار",
}

root = pathlib.Path("src/i18n")
for lang, value in VALUES.items():
    path = root / lang / "chat.ts"
    text = path.read_text(encoding="utf-8")
    if '"chat.sessionName"' in text:
        print(f"{lang}: уже есть")
        continue
    pattern = re.compile(r'(  "chat\.dialogs": "[^"]*",\n)')
    if not pattern.search(text):
        raise SystemExit(f"{lang}: не нашёл chat.dialogs")
    text = pattern.sub(r'\1  "chat.sessionName": "' + value + '",\n', text, count=1)
    path.write_text(text, encoding="utf-8")
    print(f"{lang}: добавлено")
