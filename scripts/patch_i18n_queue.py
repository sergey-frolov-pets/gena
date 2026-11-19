import io
import pathlib

BASE = pathlib.Path("/root/.picoclaw/workspace/gena/src/i18n")

CHAT = {
    "en": [
        ("chat.editMessage", "Edit message"),
        ("chat.edited", "edited · previous versions"),
        ("chat.queue.title", "Queued: {count}"),
        ("chat.queue.attachment", "attachment"),
        ("chat.queue.sendNow", "Send now"),
        ("chat.queue.edit", "Back to composer"),
        ("chat.queue.remove", "Remove from queue"),
    ],
    "ru": [
        ("chat.editMessage", "Изменить сообщение"),
        ("chat.edited", "изменено · прежние версии"),
        ("chat.queue.title", "В очереди: {count}"),
        ("chat.queue.attachment", "вложение"),
        ("chat.queue.sendNow", "Отправить сейчас"),
        ("chat.queue.edit", "Вернуть в поле ввода"),
        ("chat.queue.remove", "Убрать из очереди"),
    ],
    "de": [
        ("chat.editMessage", "Nachricht bearbeiten"),
        ("chat.edited", "bearbeitet · frühere Versionen"),
        ("chat.queue.title", "In der Warteschlange: {count}"),
        ("chat.queue.attachment", "Anhang"),
        ("chat.queue.sendNow", "Jetzt senden"),
        ("chat.queue.edit", "Zurück ins Eingabefeld"),
        ("chat.queue.remove", "Aus der Warteschlange entfernen"),
    ],
    "es": [
        ("chat.editMessage", "Editar mensaje"),
        ("chat.edited", "editado · versiones anteriores"),
        ("chat.queue.title", "En cola: {count}"),
        ("chat.queue.attachment", "adjunto"),
        ("chat.queue.sendNow", "Enviar ahora"),
        ("chat.queue.edit", "Volver al campo de texto"),
        ("chat.queue.remove", "Quitar de la cola"),
    ],
    "pt": [
        ("chat.editMessage", "Editar mensagem"),
        ("chat.edited", "editada · versões anteriores"),
        ("chat.queue.title", "Na fila: {count}"),
        ("chat.queue.attachment", "anexo"),
        ("chat.queue.sendNow", "Enviar agora"),
        ("chat.queue.edit", "Voltar ao campo de texto"),
        ("chat.queue.remove", "Remover da fila"),
    ],
    "zh": [
        ("chat.editMessage", "编辑消息"),
        ("chat.edited", "已编辑 · 历史版本"),
        ("chat.queue.title", "队列：{count}"),
        ("chat.queue.attachment", "附件"),
        ("chat.queue.sendNow", "立即发送"),
        ("chat.queue.edit", "放回输入框"),
        ("chat.queue.remove", "从队列中移除"),
    ],
    "ja": [
        ("chat.editMessage", "メッセージを編集"),
        ("chat.edited", "編集済み · 以前の版"),
        ("chat.queue.title", "キュー: {count}"),
        ("chat.queue.attachment", "添付ファイル"),
        ("chat.queue.sendNow", "今すぐ送信"),
        ("chat.queue.edit", "入力欄に戻す"),
        ("chat.queue.remove", "キューから削除"),
    ],
    "hi": [
        ("chat.editMessage", "संदेश संपादित करें"),
        ("chat.edited", "संपादित · पिछले संस्करण"),
        ("chat.queue.title", "कतार में: {count}"),
        ("chat.queue.attachment", "अनुलग्नक"),
        ("chat.queue.sendNow", "अभी भेजें"),
        ("chat.queue.edit", "इनपुट फ़ील्ड में वापस"),
        ("chat.queue.remove", "कतार से हटाएँ"),
    ],
    "ar": [
        ("chat.editMessage", "تعديل الرسالة"),
        ("chat.edited", "مُعدّلة · إصدارات سابقة"),
        ("chat.queue.title", "في الانتظار: {count}"),
        ("chat.queue.attachment", "مرفق"),
        ("chat.queue.sendNow", "إرسال الآن"),
        ("chat.queue.edit", "إعادة إلى حقل الإدخال"),
        ("chat.queue.remove", "إزالة من الانتظار"),
    ],
}

CONN = {
    "en": [
        ("connections.removeConfirmTitle", "Delete agent"),
        (
            "connections.removeConfirmText",
            'Delete agent "{name}"? Its key and settings will be removed permanently; dialogs stay.',
        ),
    ],
    "ru": [
        ("connections.removeConfirmTitle", "Удалить агента"),
        (
            "connections.removeConfirmText",
            "Удалить агента «{name}»? Ключ и настройки будут удалены безвозвратно, диалоги останутся.",
        ),
    ],
    "de": [
        ("connections.removeConfirmTitle", "Agent löschen"),
        (
            "connections.removeConfirmText",
            'Agent „{name}“ löschen? Schlüssel und Einstellungen werden endgültig entfernt, Dialoge bleiben.',
        ),
    ],
    "es": [
        ("connections.removeConfirmTitle", "Eliminar agente"),
        (
            "connections.removeConfirmText",
            "¿Eliminar el agente «{name}»? Su clave y ajustes se borrarán de forma permanente; los diálogos se conservan.",
        ),
    ],
    "pt": [
        ("connections.removeConfirmTitle", "Excluir agente"),
        (
            "connections.removeConfirmText",
            "Excluir o agente «{name}»? A chave e as configurações serão removidas permanentemente; os diálogos permanecem.",
        ),
    ],
    "zh": [
        ("connections.removeConfirmTitle", "删除智能体"),
        (
            "connections.removeConfirmText",
            "删除智能体“{name}”？其密钥和设置将被永久删除，对话将保留。",
        ),
    ],
    "ja": [
        ("connections.removeConfirmTitle", "エージェントを削除"),
        (
            "connections.removeConfirmText",
            "エージェント「{name}」を削除しますか？キーと設定は完全に削除されます。ダイアログは残ります。",
        ),
    ],
    "hi": [
        ("connections.removeConfirmTitle", "एजेंट हटाएँ"),
        (
            "connections.removeConfirmText",
            "एजेंट “{name}” हटाएँ? उसकी कुंजी और सेटिंग्स स्थायी रूप से हट जाएँगी; संवाद बने रहेंगे।",
        ),
    ],
    "ar": [
        ("connections.removeConfirmTitle", "حذف الوكيل"),
        (
            "connections.removeConfirmText",
            "حذف الوكيل «{name}»؟ سيُحذف مفتاحه وإعداداته نهائيًا، وتبقى المحادثات.",
        ),
    ],
}

MARKER = "} as const satisfies LocaleMessages;"


def esc(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def patch(locale: str, filename: str, pairs) -> None:
    path = BASE / locale / filename
    text = path.read_text(encoding="utf-8")
    if MARKER not in text:
        raise SystemExit(f"marker not found: {path}")
    lines = []
    for key, value in pairs:
        if f'"{key}"' in text:
            continue
        lines.append(f'  "{key}": "{esc(value)}",')
    if not lines:
        return
    block = "\n".join(lines) + "\n"
    text = text.replace(MARKER, block + MARKER)
    path.write_text(text, encoding="utf-8")
    print(f"patched {locale}/{filename}: +{len(lines)}")


for locale in CHAT:
    patch(locale, "chat.ts", CHAT[locale])
    patch(locale, "connections.ts", CONN[locale])
