"""Разовая правка: вынести пузырь сообщения в MessageBubble.vue.

Скрипт режет ChatView.vue по точным маркерам и падает, если маркер не один:
молчаливая замена не того блока дороже, чем упавший скрипт.
"""

from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CHAT = ROOT / "src/views/ChatView.vue"
BUBBLE = ROOT / "src/components/MessageBubble.vue"

src = CHAT.read_text(encoding="utf-8")


def unique(text: str, marker: str) -> int:
    first = text.find(marker)
    if first < 0:
        sys.exit(f"маркер не найден: {marker[:60]!r}")
    if text.find(marker, first + 1) >= 0:
        sys.exit(f"маркер встречается больше одного раза: {marker[:60]!r}")
    return first


# --- 1. Шаблон: статья сообщения → компонент -------------------------------
start = unique(src, '          <article\n            v-if="entry.message.kind !== \'thought\'"')
end_marker = "          </article>\n"
end = src.find(end_marker, start)
if end < 0:
    sys.exit("не найден конец статьи сообщения")

bubble_use = """          <MessageBubble
            v-if="entry.message.kind !== 'thought'"
            :message="entry.message"
            :text="displayContent(entry.message.content)"
            :edit-texts="(entry.message.edits ?? []).map(displayContent)"
            :images="imagesOf(entry.message)"
            :files="filesOf(entry.message)"
            :role-name="roleLabel(entry.message)"
            :clock="messageClock(entry.message)"
            :elapsed="messageElapsed(entry.index)"
            :token-target="occurrenceMessageId === entry.message.id"
            :copied="copiedId === entry.message.id"
            :speaking="speakingId === entry.message.id"
            :speech-available="speechAvailable"
            :can-lift="entry.message.role === 'user' && !entry.message.kind"
            :can-regenerate="
              entry.message.role === 'assistant' && entry.index === feed.length - 1 && !busy
            "
            @lift="startEdit(entry.message)"
            @copy="copyText(entry.message.id, entry.message.content)"
            @speak="toggleSpeech(entry.message.id, entry.message.content)"
            @download="(kind, event) => downloadReply(entry.message, kind, event)"
            @regenerate="regenerate(entry.message)"
            @open-attachment="openAttachment"
            @markdown-click="onMarkdownClick"
            @message-click="onMessageClick($event, entry.message)"
            @image-load="scrollToBottom()"
          />
"""
src = src[:start] + bubble_use + src[end + len(end_marker):]

# --- 2. Скрипт: markdown-помощники → lib/chat-markdown ---------------------
md_start = unique(src, "/** Markdown реплики → безопасный HTML (кеш внутри lib/markdown). */")
md_end = unique(src, "/**\n * Делегированный клик по markdown")
if md_end < md_start:
    sys.exit("порядок markdown-блоков неожиданный")
src = src[:md_start] + """/** HTML реплики: подписи кнопок кода и таблиц берём из текущей локали. */
const uiLabels = computed(() => markdownLabels(t));

""" + src[md_end:]

# живой стрим получает подписи тем же путём
before = src.count('v-html="mdHtml(liveStreaming)"')
if before != 1:
    sys.exit(f"живой стрим: ожидался один вызов mdHtml, найдено {before}")
src = src.replace('v-html="mdHtml(liveStreaming)"', 'v-html="mdHtml(liveStreaming, uiLabels)"')

# --- 3. Импорты ------------------------------------------------------------
src = src.replace(
    'import { renderMarkdown } from "@/lib/markdown";\n',
    'import { markdownLabels, mdHtml } from "@/lib/chat-markdown";\n',
    1,
)
src = src.replace('import { splitContent } from "@/lib/ui-blocks";\n', "", 1)
src = src.replace("  formatBytes,\n", "", 1)
anchor = 'import SessionQueue from "@/components/SessionQueue.vue";\n'
if anchor not in src:
    # запасной вариант: любой импорт компонента
    m = re.search(r'^import .*from "@/components/[^\n]+\n', src, re.M)
    if not m:
        sys.exit("не найден импорт компонента")
    anchor = m.group(0)
src = src.replace(anchor, anchor + 'import MessageBubble from "@/components/MessageBubble.vue";\n', 1)

# --- 4. Стили пузыря → дочерний компонент ----------------------------------
STYLE_AT = src.index("<style scoped>")
DYNAMIC = [
    ".chat-panel__message",
    ".chat-panel__message--user",
    ".chat-panel__message--assistant",
    ".chat-panel__role",
    ".chat-panel__time",
    ".chat-panel__elapsed",
    ".chat-panel__content",
    ".chat-panel__message-actions",
    ".chat-panel__message:hover .chat-panel__message-actions",
    ".chat-panel__edits",
    ".chat-panel__edits summary",
    ".chat-panel__edits .chat-panel__content",
    ".chat-panel__images",
    '.chat-panel__images[data-count="1"]',
    ".chat-panel__image",
    ".chat-panel__image img",
    ".chat-panel__file-row",
    ".chat-panel__file-badge",
    ".chat-panel__file-name",
    ".chat-panel__file-size",
    ".chat-panel__message.is-token-target",
]

MEDIA_RULES = [
    (".chat-panel__message-actions", "  .chat-panel__message-actions {\n    opacity: 1;\n  }\n"),
    (
        ".chat-panel__message--user",
        "  .chat-panel__message--user {\n    margin-inline-start: 1rem;\n  }\n",
    ),
]


def block_at(text: str, pos: int) -> int:
    """Конец CSS-блока, начинающегося в pos (учитывая вложенные скобки)."""
    depth = 0
    for k in range(pos, len(text)):
        if text[k] == "{":
            depth += 1
        elif text[k] == "}":
            depth -= 1
            if depth == 0:
                return k + 1
    sys.exit("незакрытый CSS-блок")
    return -1


moved: list[tuple[int, str]] = []

for selector in DYNAMIC:
    pattern = re.compile(r"^" + re.escape(selector) + r" ?[,{]", re.M)
    matches = list(pattern.finditer(src, STYLE_AT))
    if len(matches) != 1:
        sys.exit(f"{selector}: ожидалось одно правило, найдено {len(matches)}")
    m = matches[0]
    end = block_at(src, m.start())
    if end < len(src) and src[end] == "\n":
        end += 1
    rule = src[m.start():end]
    moved.append((m.start(), rule))
    src = src[:m.start()] + src[end:]

media_moved = []
for selector, literal in MEDIA_RULES:
    if src.count(literal) != 1:
        sys.exit(f"@{selector} в медиа: ожидалось одно вхождение")
    src = src.replace(literal, "", 1)
    media_moved.append(literal)

moved.sort(key=lambda item: item[0])
bubble_css = "\n".join(rule.rstrip("\n") + "\n" for _, rule in moved)
if media_moved:
    bubble_css += "@media (max-width: 720px) {\n" + "".join(media_moved) + "}\n"


CHAT.write_text(src, encoding="utf-8")

bubble = BUBBLE.read_text(encoding="utf-8")
if "/*__BUBBLE_CSS__*/" not in bubble:
    sys.exit("в MessageBubble нет метки для стилей")
BUBBLE.write_text(bubble.replace("/*__BUBBLE_CSS__*/", bubble_css.strip("\n")), encoding="utf-8")

print(f"правил перенесено: {len(moved)} + медиа {len(media_moved)}")
print(f"ChatView: {len(src.splitlines())} строк")
