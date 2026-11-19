<script setup lang="ts">
/**
 * Чат Gena. Разметка и стили — порт `AiChatPanel` из code2graph
 * (toolbar → stage с пузырями → dock с композером), данные и транспорт — Gena.
 * Голос: диктовка (Web Speech) и озвучка ответов (Speech Synthesis).
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import {
  activeSessionId,
  agents,
  appendMessage,
  createSession,
  deleteMessagesFrom,
  duplicateSession,
  getAgentKey,
  loadMessages,
  messages,
  pinSession,
  removeSession,
  renameSession,
  sessions,
} from "@/lib/store";
import { sendToAgent, type TransportAttachment } from "@/lib/agent-client";
import { describeError } from "@/lib/errors";
import { canCall, getCallCount, recordCall } from "@/storage/usage";
import { useLocale } from "@/i18n";
import {
  dictationAvailable,
  dictationError,
  dictationListening,
  stopDictation,
  toggleDictation,
} from "@/lib/dictation";
import {
  autoSpeak,
  setAutoSpeak,
  speak,
  speakingId,
  speechAvailable,
  toggleSpeech,
} from "@/lib/speech";
import type { Agent, Message, MessageAttachment, Session } from "@/storage/types";
import { ImageError, prepareImage, type PreparedImage } from "@/lib/images";
import { attachmentFromBlobUrl, fetchMediaBlob, getCachedMedia } from "@/lib/media";

const { t } = useLocale();

const agentId = ref("");
const draft = ref("");
const busy = ref(false);
const typing = ref(false);
const error = ref("");
const notice = ref("");
/** Сколько вызовов сделано сегодня у выбранного агента. */
const usedToday = ref(0);
/** Последний отправленный текст — для кнопки «Повторить». */
const lastText = ref("");
/** Контроллер отмены текущего хода. */
const abortCtrl = ref<AbortController | null>(null);
/** Накопленный текст стриминга. */
const streamingText = ref("");
/** Контейнер сообщений — для автоскролла. */
const messagesEl = ref<HTMLElement | null>(null);
/** Поле ввода — чтобы вернуть фокус после отправки. */
const composerEl = ref<HTMLTextAreaElement | null>(null);
/** Шит истории диалогов (как в AiChatPanel). */
const historyOpen = ref(false);
const historyQuery = ref("");
/** Режим переименования диалога в шапке. */
const renaming = ref(false);
const renameDraft = ref("");
/** Что только что скопировали — для галочки «Скопировано». */
const copiedId = ref("");
/** Изображения, готовые к отправке (полный data-URL живёт только в памяти). */
const pendingImages = ref<PreparedImage[]>([]);
/** Локализованная ошибка подготовки вложения. */
const attachError = ref("");
/** Скрытый input[type=file] для кнопки-скрепки. */
const fileInput = ref<HTMLInputElement | null>(null);
/** Просмотр изображения на весь экран. */
const lightbox = ref("");
const MAX_IMAGES = 5;

const agentSessions = computed<Session[]>(() =>
  sessions.value.filter((s) => !agentId.value || s.agentId === agentId.value),
);

const filteredSessions = computed<Session[]>(() => {
  const query = historyQuery.value.trim().toLowerCase();
  const list = query
    ? agentSessions.value.filter((s) => s.title.toLowerCase().includes(query))
    : [...agentSessions.value];
  // Закреплённые сверху, дальше — по времени обновления.
  return list.sort((a, b) => {
    const pinA = a.pinned ? 1 : 0;
    const pinB = b.pinned ? 1 : 0;
    if (pinA !== pinB) return pinB - pinA;
    return b.updatedAt - a.updatedAt;
  });
});

/** Диалог, у которого подтверждаем удаление. */
const confirmDeleteId = ref("");

const activeSession = computed<Session | undefined>(() =>
  sessions.value.find((s) => s.id === activeSessionId.value),
);

const activeAgent = computed(() =>
  agents.value.find((a) => a.id === (activeSession.value?.agentId ?? agentId.value)),
);

const callLimit = computed(() => activeAgent.value?.settings.callLimit ?? 0);

const limitLabel = computed(() => {
  if (callLimit.value <= 0) return "";
  return t("chat.usage", { used: usedToday.value, limit: callLimit.value });
});

const canSend = computed(
  () =>
    Boolean(activeSession.value) &&
    (draft.value.trim().length > 0 || pendingImages.value.length > 0) &&
    !busy.value,
);

/** Вложения принимает только протокол Pico WS (`payload.media`). */
const supportsImages = computed(
  () => (activeAgent.value?.protocol ?? "http_json") === "pico_ws",
);

const dictationMessage = computed(() => {
  if (!dictationError.value) return "";
  if (
    dictationError.value === "not-allowed" ||
    dictationError.value === "service-not-allowed" ||
    dictationError.value === "audio-capture"
  ) {
    return t("chat.dictateError.notAllowed");
  }
  return t("chat.dictateError.network");
});

async function refreshUsage(): Promise<void> {
  const agent = activeAgent.value;
  if (!agent) {
    usedToday.value = 0;
    return;
  }
  usedToday.value = await getCallCount(agent.id);
}

watch([agentId, activeSessionId, agents], refreshUsage, { immediate: true });

async function scrollToBottom(): Promise<void> {
  await nextTick();
  if (messagesEl.value) {
    messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
  }
}
watch([messages, streamingText, typing], scrollToBottom);

/** Растущее поле ввода, как в AiChatPanel (до 4 строк). */
async function autoGrow(): Promise<void> {
  await nextTick();
  const el = composerEl.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 4 * 22)}px`;
}
watch(draft, autoGrow);

async function newSession(): Promise<void> {
  error.value = "";
  notice.value = "";
  stopDictation();
  if (!agentId.value) {
    error.value = t("chat.error.chooseAgent");
    return;
  }
  const session = await createSession(agentId.value, t("chat.newDialogTitle"));
  await loadMessages(session.id);
  historyOpen.value = false;
}

async function openSession(id: string): Promise<void> {
  stopDictation();
  await loadMessages(id);
  historyOpen.value = false;
}

async function send(): Promise<void> {
  error.value = "";
  notice.value = "";
  const text = draft.value.trim();
  const media = pendingImages.value.map((img) => img.dataUrl);
  const attachments: MessageAttachment[] = pendingImages.value.map((img) => ({
    kind: "image",
    thumb: img.thumb,
    width: img.width,
    height: img.height,
  }));
  if ((!text && media.length === 0) || busy.value) return;

  const session = activeSession.value;
  if (!session) {
    error.value = t("chat.error.noSession");
    return;
  }
  const agent = agents.value.find((a) => a.id === session.agentId);
  if (!agent) {
    error.value = t("chat.error.agentNotFound");
    return;
  }
  if (!agent.sealedKey) {
    error.value = t("chat.error.noKey");
    return;
  }
  if (!(await withinLimit(agent))) return;

  draft.value = "";
  pendingImages.value = [];
  await appendMessage(session.id, "user", text, undefined, attachments);
  await exchange(session, agent, text, media);
}

/** Проверка дневного лимита вызовов; false — отправлять нельзя. */
async function withinLimit(agent: Agent): Promise<boolean> {
  const limit = agent.settings.callLimit;
  if (limit <= 0) return true;
  if (await canCall(agent.id, limit)) return true;
  error.value = t("chat.error.limitReached", { limit });
  await refreshUsage();
  return false;
}

/** Скачать входящие изображения и превратить их в миниатюры для истории. */
async function collectIncoming(
  agent: Agent,
  key: string,
  list: TransportAttachment[],
): Promise<MessageAttachment[]> {
  if (list.length === 0) return [];
  const result: MessageAttachment[] = [];
  for (const item of list) {
    try {
      const blobUrl = await fetchMediaBlob(agent.address, key, item.url);
      result.push(await attachmentFromBlobUrl(blobUrl, item.url));
    } catch {
      attachError.value = t("chat.attachIncomingError");
    }
  }
  return result;
}

/** Один ход: отправка реплики агенту, приём ответа и его вложений. */
async function exchange(
  session: Session,
  agent: Agent,
  text: string,
  media: string[],
): Promise<void> {
  stopDictation();
  lastText.value = text;
  busy.value = true;
  streamingText.value = "";
  const controller = new AbortController();
  abortCtrl.value = controller;
  const limit = agent.settings.callLimit;
  try {
    const key = await getAgentKey(agent);
    // В контекст идут только обычные текстовые сообщения (без мыслей/tool_calls).
    const history = messages.value.filter(
      (m) => m.role !== "system" && (m.kind === undefined || m.kind === "text"),
    );
    const response = await sendToAgent(
      agent,
      key,
      {
        message: text,
        media,
        sessionId: session.id,
        settings: agent.settings,
        history,
      },
      {
        signal: controller.signal,
        events: {
          onTyping: (on) => {
            typing.value = on;
          },
          onDelta: (_id, chunk) => {
            streamingText.value += chunk;
          },
          onMessage: async (m) => {
            await appendMessage(session.id, "assistant", m.content, m.kind);
          },
        },
      },
    );
    const incoming = await collectIncoming(agent, key, response.attachments ?? []);
    const reply = await appendMessage(
      session.id,
      "assistant",
      response.reply,
      undefined,
      incoming,
    );
    await recordCall(agent.id);
    await refreshUsage();
    if (autoSpeak.value && response.reply.trim()) {
      speak(reply.id, response.reply);
    }
    if (limit > 0) {
      notice.value = t("chat.remaining", { remaining: Math.max(0, limit - usedToday.value) });
    }
  } catch (e) {
    error.value = describeError(e, t);
  } finally {
    busy.value = false;
    typing.value = false;
    abortCtrl.value = null;
    streamingText.value = "";
    await nextTick();
    composerEl.value?.focus();
  }
}

/**
 * «Повторить ответ»: удаляет ответ и всё, что после него, и отправляет
 * последнюю реплику пользователя заново. Вложения из истории не повторяются —
 * в IndexedDB лежит только миниатюра.
 */
async function regenerate(m: Message): Promise<void> {
  if (busy.value) return;
  const session = activeSession.value;
  const agent = activeAgent.value;
  if (!session || !agent) return;
  if (!agent.sealedKey) {
    error.value = t("chat.error.noKey");
    return;
  }

  const index = messages.value.findIndex((item) => item.id === m.id);
  let prompt = "";
  for (let i = index - 1; i >= 0; i--) {
    if (messages.value[i].role === "user") {
      prompt = messages.value[i].content;
      break;
    }
  }
  if (!prompt) {
    error.value = t("chat.error.noPrompt");
    return;
  }

  error.value = "";
  notice.value = "";
  if (!(await withinLimit(agent))) return;
  await deleteMessagesFrom(session.id, m.createdAt);
  await exchange(session, agent, prompt, []);
}

function stop(): void {
  abortCtrl.value?.abort();
}

async function retry(): Promise<void> {
  if (busy.value || !lastText.value) return;
  draft.value = lastText.value;
  await send();
}

function onDictateToggle(): void {
  toggleDictation(draft);
  void autoGrow();
}

async function copyText(id: string, text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    copiedId.value = id;
    window.setTimeout(() => {
      if (copiedId.value === id) copiedId.value = "";
    }, 1500);
  } catch {
    // Буфер обмена недоступен (нет разрешения) — молча пропускаем.
  }
}

async function copyChat(): Promise<void> {
  const lines = messages.value
    .filter((m) => m.kind === undefined || m.kind === "text")
    .map((m) => `${t(`chat.role.${m.role}` as never)}: ${m.content}`);
  if (lines.length === 0) return;
  await copyText("chat", lines.join("\n\n"));
}

function toggleAutoSpeak(): void {
  setAutoSpeak(!autoSpeak.value);
}

function startRename(): void {
  renameDraft.value = activeSession.value?.title ?? "";
  renaming.value = true;
}

async function commitRename(): Promise<void> {
  const session = activeSession.value;
  renaming.value = false;
  if (!session) return;
  await renameSession(session.id, renameDraft.value.trim() || session.title);
}

async function togglePin(session: Session): Promise<void> {
  await pinSession(session.id, !session.pinned);
}

async function duplicate(session: Session): Promise<void> {
  const copy = await duplicateSession(session.id);
  if (copy) await openSession(copy.id);
}

async function removeDialog(sessionId: string): Promise<void> {
  confirmDeleteId.value = "";
  await removeSession(sessionId);
}

function attachMessage(code: string): string {
  if (code === "too_large") return t("chat.attachError.size");
  return t("chat.attachError.type");
}

function pickImages(): void {
  fileInput.value?.click();
}

async function addFiles(files: File[]): Promise<void> {
  if (files.length === 0) return;
  attachError.value = "";
  for (const file of files) {
    if (pendingImages.value.length >= MAX_IMAGES) {
      attachError.value = t("chat.attachError.count");
      break;
    }
    try {
      const prepared = await prepareImage(file);
      pendingImages.value = [...pendingImages.value, prepared];
    } catch (e) {
      attachError.value =
        e instanceof ImageError ? attachMessage(e.code) : t("chat.attachError.type");
    }
  }
  await autoGrow();
}

async function onFilesPicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  await addFiles(Array.from(input.files ?? []));
  input.value = "";
}

function removeImage(index: number): void {
  pendingImages.value = pendingImages.value.filter((_, i) => i !== index);
  attachError.value = "";
}

function onPaste(event: ClipboardEvent): void {
  const files = Array.from(event.clipboardData?.files ?? []).filter((f) =>
    f.type.startsWith("image/"),
  );
  if (files.length === 0) return;
  event.preventDefault();
  void addFiles(files);
}

function onDrop(event: DragEvent): void {
  const files = Array.from(event.dataTransfer?.files ?? []).filter((f) =>
    f.type.startsWith("image/"),
  );
  if (files.length === 0) return;
  void addFiles(files);
}

/** Полный размер: из кеша blob-URL либо догружаем с авторизацией. */
async function openAttachment(attachment: MessageAttachment): Promise<void> {
  const agent = activeAgent.value;
  if (attachment.refUrl && agent?.address) {
    const cached = getCachedMedia(agent.address, attachment.refUrl);
    if (cached) {
      lightbox.value = cached;
      return;
    }
    try {
      const key = await getAgentKey(agent);
      lightbox.value = await fetchMediaBlob(agent.address, key, attachment.refUrl);
      return;
    } catch {
      // Сервер недоступен — остаётся миниатюра.
    }
  }
  lightbox.value = attachment.thumb;
}

function onLightboxKey(event: KeyboardEvent): void {
  if (event.key === "Escape") lightbox.value = "";
}

watch(lightbox, (open) => {
  if (open) window.addEventListener("keydown", onLightboxKey, { once: true });
});

/** Высота видимой области: на мобильном клавиатура ужимает `visualViewport`. */
function syncViewport(): void {
  const viewport = window.visualViewport;
  const height = viewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty("--app-vvh", `${Math.round(height)}px`);
  void scrollToBottom();
}

onMounted(() => {
  syncViewport();
  window.visualViewport?.addEventListener("resize", syncViewport);
  window.visualViewport?.addEventListener("scroll", syncViewport);
  window.addEventListener("resize", syncViewport);
});

onUnmounted(() => {
  window.visualViewport?.removeEventListener("resize", syncViewport);
  window.visualViewport?.removeEventListener("scroll", syncViewport);
  window.removeEventListener("resize", syncViewport);
  document.documentElement.style.removeProperty("--app-vvh");
  abortCtrl.value?.abort();
});

function useStarter(n: number): void {
  draft.value = t(`chat.starters.${n}` as never);
  void autoGrow();
  composerEl.value?.focus();
}

function protocolLabel(): string {
  const p = activeAgent.value?.protocol ?? "http_json";
  return t(("connections.protocol." + p) as never);
}
</script>

<template>
  <section class="chat-panel">
    <!-- toolbar: заголовок диалога + действия -->
    <div class="chat-panel__toolbar">
      <button
        v-if="!renaming"
        class="chat-panel__title"
        type="button"
        :aria-label="activeSession?.title || t('chat.selectOrCreate')"
        @click="startRename"
      >
        <span class="chat-panel__title-text">
          {{ activeSession?.title || t("chat.selectOrCreate") }}
        </span>
      </button>
      <template v-else>
        <input
          v-model="renameDraft"
          class="chat-panel__rename"
          :aria-label="t('chat.renamePlaceholder')"
          @keydown.enter.prevent="commitRename"
          @keydown.esc.prevent="renaming = false"
        />
        <button class="chat-panel__tool is-text" type="button" @click="commitRename">
          {{ t("chat.rename") }}
        </button>
      </template>

      <template v-if="!renaming">
        <button
          type="button"
          class="chat-panel__tool"
          v-tip="t('chat.newDialog')"
          :aria-label="t('chat.newDialog')"
          :disabled="!agentId"
          @click="newSession"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <button
          type="button"
          class="chat-panel__tool"
          v-tip="t('chat.dialogs')"
          :aria-label="t('chat.dialogs')"
          :aria-pressed="historyOpen"
          @click="historyOpen = !historyOpen"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <path d="M3 4v5h5" />
            <path d="M12 8v4l3 2" />
          </svg>
        </button>
        <button
          type="button"
          class="chat-panel__tool"
          v-tip="copiedId === 'chat' ? t('chat.copied') : t('chat.copyMessage')"
          :aria-label="t('chat.copyMessage')"
          :disabled="messages.length === 0"
          @click="copyChat"
        >
          <svg v-if="copiedId === 'chat'" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m5 13 4 4L19 7" />
          </svg>
          <svg v-else viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" />
          </svg>
        </button>
        <button
          v-if="speechAvailable"
          type="button"
          class="chat-panel__tool"
          :class="{ 'is-on': autoSpeak }"
          v-tip="t('chat.autoSpeak')"
          :aria-label="t('chat.autoSpeak')"
          :aria-pressed="autoSpeak"
          @click="toggleAutoSpeak"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M11 5 6 9H3v6h3l5 4z" />
            <path d="M16 9a4 4 0 0 1 0 6" />
            <path d="M19 6a8 8 0 0 1 0 12" />
          </svg>
        </button>
      </template>
    </div>

    <div class="chat-panel__agentbar">
      <select v-model="agentId" class="chat-panel__agent" :aria-label="t('chat.agent')">
        <option value="">{{ t("chat.selectAgent") }}</option>
        <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.name }}</option>
      </select>
      <span v-if="activeAgent" class="chat-panel__badge">{{ protocolLabel() }}</span>
      <span v-if="limitLabel" class="chat-panel__usage">{{ limitLabel }}</span>
    </div>

    <div class="chat-panel__stage">
      <div
        v-if="historyOpen"
        class="chat-panel__sheet-backdrop"
        @click="historyOpen = false"
      />
      <aside
        v-if="historyOpen"
        class="chat-panel__sheet"
        role="dialog"
        aria-modal="true"
        :aria-label="t('chat.dialogs')"
      >
        <div class="chat-panel__sheet-head">
          <input
            v-model="historyQuery"
            class="chat-panel__search"
            type="search"
            :placeholder="t('chat.searchDialogs')"
            :aria-label="t('chat.searchDialogs')"
          />
          <button
            type="button"
            class="chat-panel__tool"
            v-tip="t('chat.close')"
            :aria-label="t('chat.close')"
            @click="historyOpen = false"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <p v-if="filteredSessions.length === 0" class="chat-panel__muted">
          {{ t("chat.selectOrCreate") }}
        </p>
        <ul class="chat-panel__session-list">
          <li
            v-for="s in filteredSessions"
            :key="s.id"
            class="chat-panel__session"
            :class="{ 'is-active': s.id === activeSessionId, 'is-pinned': s.pinned }"
          >
            <button class="chat-panel__session-open" type="button" @click="openSession(s.id)">
              <span class="chat-panel__session-title">{{ s.title }}</span>
              <span class="chat-panel__session-count">{{ s.messageCount }}</span>
            </button>

            <div v-if="confirmDeleteId !== s.id" class="chat-panel__session-actions">
              <button
                type="button"
                class="chat-panel__action"
                :class="{ 'is-on': s.pinned }"
                v-tip="s.pinned ? t('chat.unpin') : t('chat.pin')"
                :aria-label="s.pinned ? t('chat.unpin') : t('chat.pin')"
                @click="togglePin(s)"
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M12 17v5" />
                  <path d="M9 3h6l-1 6 3 3H7l3-3z" />
                </svg>
              </button>
              <button
                type="button"
                class="chat-panel__action"
                v-tip="t('chat.duplicate')"
                :aria-label="t('chat.duplicate')"
                @click="duplicate(s)"
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="9" y="9" width="11" height="11" rx="2" />
                  <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                </svg>
              </button>
              <button
                type="button"
                class="chat-panel__action is-danger"
                v-tip="t('chat.deleteDialog')"
                :aria-label="t('chat.deleteDialog')"
                @click="confirmDeleteId = s.id"
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
                </svg>
              </button>
            </div>

            <div v-else class="chat-panel__confirm">
              <span class="chat-panel__confirm-text">
                {{ t("chat.deleteConfirm", { title: s.title }) }}
              </span>
              <button
                type="button"
                class="chat-panel__link is-danger"
                @click="removeDialog(s.id)"
              >
                {{ t("chat.confirm") }}
              </button>
              <button type="button" class="chat-panel__link" @click="confirmDeleteId = ''">
                {{ t("chat.cancel") }}
              </button>
            </div>
          </li>
        </ul>
      </aside>

      <div
        ref="messagesEl"
        class="chat-panel__messages"
        role="log"
        aria-live="polite"
        @dragover.prevent
        @drop.prevent="onDrop"
      >
        <template v-for="(m, index) in messages" :key="m.id">
          <details v-if="m.kind === 'thought'" class="chat-panel__aux">
            <summary>{{ t("chat.thought") }}</summary>
            <div class="chat-panel__content">{{ m.content }}</div>
          </details>
          <details v-else-if="m.kind === 'tool_calls'" class="chat-panel__aux">
            <summary>{{ t("chat.toolCalls") }}</summary>
            <div class="chat-panel__content">{{ m.content }}</div>
          </details>
          <article v-else class="chat-panel__message" :class="`chat-panel__message--${m.role}`">
            <span class="chat-panel__role">{{ t(`chat.role.${m.role}` as never) }}</span>
            <p v-if="m.content" class="chat-panel__content">{{ m.content }}</p>
            <div
              v-if="m.attachments?.length"
              class="chat-panel__images"
              :data-count="Math.min(m.attachments.length, 4)"
            >
              <button
                v-for="(a, i) in m.attachments.slice(0, 4)"
                :key="i"
                type="button"
                class="chat-panel__image"
                @click="openAttachment(a)"
              >
                <img :src="a.thumb" alt="" loading="lazy" />
              </button>
            </div>
            <div class="chat-panel__message-actions">
              <button
                type="button"
                class="chat-panel__action"
                v-tip="copiedId === m.id ? t('chat.copied') : t('chat.copyMessage')"
                :aria-label="t('chat.copyMessage')"
                @click="copyText(m.id, m.content)"
              >
                <svg v-if="copiedId === m.id" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m5 13 4 4L19 7" />
                </svg>
                <svg v-else viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="9" y="9" width="11" height="11" rx="2" />
                  <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                </svg>
              </button>
              <button
                v-if="m.role === 'assistant' && speechAvailable"
                type="button"
                class="chat-panel__action"
                :class="{ 'is-on': speakingId === m.id }"
                v-tip="speakingId === m.id ? t('chat.stopSpeaking') : t('chat.speakReply')"
                :aria-label="speakingId === m.id ? t('chat.stopSpeaking') : t('chat.speakReply')"
                :aria-pressed="speakingId === m.id"
                @click="toggleSpeech(m.id, m.content)"
              >
                <svg v-if="speakingId === m.id" viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
                  <rect x="7" y="7" width="10" height="10" rx="2" />
                </svg>
                <svg v-else viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M11 5 6 9H3v6h3l5 4z" />
                  <path d="M16 9a4 4 0 0 1 0 6" />
                </svg>
              </button>
              <button
                v-if="m.role === 'assistant' && index === messages.length - 1 && !busy"
                type="button"
                class="chat-panel__action"
                v-tip="t('chat.regenerate')"
                :aria-label="t('chat.regenerate')"
                @click="regenerate(m)"
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M20 12a8 8 0 1 1-2.34-5.66" />
                  <path d="M20 4v5h-5" />
                </svg>
              </button>
            </div>
          </article>
        </template>

        <article v-if="streamingText" class="chat-panel__message chat-panel__message--assistant">
          <span class="chat-panel__role">{{ t("chat.role.assistant") }}</span>
          <p class="chat-panel__content">{{ streamingText }}</p>
        </article>

        <div
          v-if="messages.length === 0 && !typing && !streamingText"
          class="chat-panel__empty"
        >
          <p class="chat-panel__empty-text">{{ t("chat.messagesEmpty") }}</p>
          <p class="chat-panel__empty-title">{{ t("chat.starters.title") }}</p>
          <div class="chat-panel__starters">
            <button
              v-for="n in 3"
              :key="n"
              type="button"
              class="chat-panel__starter"
              :disabled="!activeSession"
              @click="useStarter(n)"
            >
              {{ t(`chat.starters.${n}` as never) }}
            </button>
          </div>
        </div>
        <p v-if="typing" class="chat-panel__thinking">{{ t("chat.typing") }}</p>
      </div>
    </div>

    <div class="chat-panel__dock">
      <p v-if="dictationListening" class="chat-panel__recording" role="status" aria-live="polite">
        <span class="chat-panel__recording-dot" aria-hidden="true" />
        {{ t("chat.dictateRecording") }}
      </p>
      <p v-if="dictationMessage" class="chat-panel__warning" role="alert">{{ dictationMessage }}</p>
      <p v-if="attachError" class="chat-panel__warning" role="alert">{{ attachError }}</p>
      <p v-if="error" class="chat-panel__warning" role="alert">
        {{ error }}
        <button v-if="lastText" type="button" class="chat-panel__link" @click="retry">
          {{ t("chat.retry") }}
        </button>
      </p>
      <p v-if="notice" class="chat-panel__notice" role="status">{{ notice }}</p>

      <form class="chat-panel__composer" @submit.prevent="send">
        <div v-if="pendingImages.length > 0" class="chat-panel__chips">
          <div v-for="(img, i) in pendingImages" :key="i" class="chat-panel__chip">
            <img :src="img.thumb" alt="" />
            <button
              type="button"
              class="chat-panel__chip-remove"
              v-tip="t('chat.attachRemove')"
              :aria-label="t('chat.attachRemove')"
              @click="removeImage(i)"
            >
              ×
            </button>
          </div>
        </div>
        <input
          ref="fileInput"
          class="chat-panel__file"
          type="file"
          accept="image/*"
          multiple
          @change="onFilesPicked"
        />
        <div class="chat-panel__composer-box" :class="{ 'is-recording': dictationListening }">
          <button
            v-if="supportsImages"
            type="button"
            class="chat-panel__icon-btn"
            v-tip="t('chat.attach')"
            :aria-label="t('chat.attach')"
            :disabled="!activeSession"
            @click="pickImages"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M21 12.5V7a4 4 0 0 0-4-4h-9a4 4 0 0 0-4 4v10a4 4 0 0 0 4 4h6" />
              <path d="m3 16 4.5-4.5a2 2 0 0 1 2.8 0L15 16" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M18 15v6M15 18h6" />
            </svg>
          </button>
          <textarea
            ref="composerEl"
            v-model="draft"
            class="chat-panel__input"
            rows="1"
            enterkeyhint="send"
            :placeholder="t('chat.composerPlaceholder')"
            :aria-label="t('chat.composerPlaceholder')"
            :disabled="!activeSession"
            @keydown.enter.exact.prevent="send"
            @paste="onPaste"
          />
          <button
            v-if="dictationAvailable"
            type="button"
            class="chat-panel__icon-btn chat-panel__mic"
            :class="{ 'is-listening': dictationListening }"
            v-tip="dictationListening ? t('chat.dictateStop') : t('chat.dictate')"
            :aria-label="dictationListening ? t('chat.dictateStop') : t('chat.dictate')"
            :aria-pressed="dictationListening"
            :disabled="!activeSession"
            @click="onDictateToggle"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0" />
              <path d="M12 18v3" />
            </svg>
          </button>
          <button
            v-if="busy"
            type="button"
            class="chat-panel__send"
            v-tip="t('chat.stop')"
            :aria-label="t('chat.stop')"
            @click="stop"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
              <rect x="7" y="7" width="10" height="10" rx="2" />
            </svg>
          </button>
          <button
            v-else
            type="submit"
            class="chat-panel__send is-primary"
            v-tip="t('chat.send')"
            :aria-label="t('chat.send')"
            :disabled="!canSend"
          >
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M4 12h15" />
              <path d="m13 6 6 6-6 6" />
            </svg>
          </button>
        </div>
      </form>
    </div>

    <div
      v-if="lightbox"
      class="chat-panel__lightbox"
      role="dialog"
      aria-modal="true"
      @click="lightbox = ''"
    >
      <img :src="lightbox" alt="" />
    </div>
  </section>
</template>

<style scoped>
/* --- Каркас: как .ai-chat-panel ------------------------------------------- */
.chat-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  height: calc(var(--app-vvh, 100vh) - 132px);
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--panel);
  overflow: hidden;
}

.chat-panel__toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
}

.chat-panel__title {
  flex: 1 1 auto;
  min-width: 0;
  padding: 6px 8px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--text);
  text-align: start;
  cursor: pointer;
}

.chat-panel__title:hover {
  background: var(--panel-2);
}

.chat-panel__title-text {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
  font-size: 0.92rem;
}

.chat-panel__rename {
  flex: 1 1 auto;
  min-width: 0;
  padding: 6px 8px;
}

.chat-panel__tool {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.chat-panel__tool:hover:not(:disabled) {
  color: var(--text);
  background: var(--panel-2);
}

.chat-panel__tool:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.chat-panel__tool.is-on {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}

.chat-panel__tool.is-text {
  width: auto;
  padding: 0 10px;
  font-size: 0.82rem;
}

.chat-panel__agentbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px 6px;
  border-bottom: 1px solid var(--border);
}

.chat-panel__agent {
  width: auto;
  max-width: 60%;
  padding: 4px 8px;
  font-size: 0.82rem;
}

.chat-panel__badge {
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--panel-2);
  color: var(--muted);
  font-size: 11px;
  white-space: nowrap;
}

.chat-panel__usage {
  margin-inline-start: auto;
  color: var(--muted);
  font-size: 0.75rem;
  white-space: nowrap;
}

/* --- Stage и история ------------------------------------------------------ */
.chat-panel__stage {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.chat-panel__sheet-backdrop {
  position: absolute;
  inset: 0;
  z-index: 30;
  background: rgba(0, 0, 0, 0.45);
  animation: gena-fade-in 160ms ease;
}

.chat-panel__sheet {
  position: absolute;
  inset-block: 0;
  inset-inline-end: 0;
  z-index: 31;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: min(86vw, 360px);
  padding: 10px;
  border-inline-start: 1px solid var(--border);
  background: var(--panel);
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.28);
  overflow-y: auto;
  animation: gena-sheet-in 180ms ease;
}

@keyframes gena-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes gena-sheet-in {
  from {
    transform: translateX(100%);
  }
  to {
    transform: translateX(0);
  }
}

.chat-panel__sheet-head {
  display: flex;
  align-items: center;
  gap: 4px;
}

.chat-panel__search {
  padding: 6px 10px;
}

.chat-panel__session-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.chat-panel__session {
  display: flex;
  align-items: center;
  gap: 2px;
}

.chat-panel__session-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 2px;
  opacity: 0;
  transition: opacity 120ms ease;
}

.chat-panel__session:hover .chat-panel__session-actions,
.chat-panel__session:focus-within .chat-panel__session-actions,
.chat-panel__session.is-active .chat-panel__session-actions {
  opacity: 1;
}

@media (hover: none) {
  .chat-panel__session-actions {
    opacity: 1;
  }
}

.chat-panel__session.is-pinned .chat-panel__session-title {
  font-weight: 600;
}

.chat-panel__session .chat-panel__action {
  width: 28px;
  height: 28px;
}

.chat-panel__action.is-danger:hover {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 14%, transparent);
}

.chat-panel__confirm {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 2px 8px;
  padding: 4px 6px;
  border: 1px solid var(--danger);
  border-radius: 10px;
}

.chat-panel__confirm-text {
  flex: 1 1 100%;
  color: var(--danger);
  font-size: 0.74rem;
  line-height: 1.3;
}

.chat-panel__link.is-danger {
  color: var(--danger);
}

.chat-panel__session-open {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--text);
  text-align: start;
  cursor: pointer;
}

.chat-panel__session-open:hover {
  background: var(--panel-2);
}

.chat-panel__session.is-active .chat-panel__session-open {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
}

.chat-panel__session-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.86rem;
}

.chat-panel__session-count {
  flex: 0 0 auto;
  color: var(--muted);
  font-size: 0.72rem;
}

.chat-panel__messages {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px 8px 0;
  overflow-y: auto;
}

/* --- Пузыри: как .ai-chat-panel__message --------------------------------- */
.chat-panel__message {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: min(100%, 36rem);
  padding: 4px 10px;
  border-radius: 14px;
}

.chat-panel__message--user {
  align-self: flex-end;
  margin-inline-start: 2rem;
  background: color-mix(in srgb, var(--accent) 14%, var(--panel));
  border-end-end-radius: 4px;
}

.chat-panel__message--assistant {
  align-self: flex-start;
  margin-inline-start: 0.75rem;
  margin-inline-end: 1.25rem;
  padding-inline: 0;
  background: transparent;
}

.chat-panel__role {
  color: var(--muted);
  font-size: 0.68rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.chat-panel__content {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.45;
  font-size: 0.88rem;
}

.chat-panel__message-actions {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 120ms ease;
}

.chat-panel__message:hover .chat-panel__message-actions,
.chat-panel__message:focus-within .chat-panel__message-actions,
.chat-panel__message:last-child .chat-panel__message-actions {
  opacity: 1;
}

.chat-panel__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.chat-panel__action:hover {
  color: var(--text);
  background: var(--panel-2);
}

.chat-panel__action.is-on {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 16%, transparent);
}

.chat-panel__aux {
  align-self: stretch;
  padding: 6px 10px;
  border: 1px dashed var(--border);
  border-radius: 10px;
  background: transparent;
}

.chat-panel__aux summary {
  cursor: pointer;
  color: var(--muted);
  font-size: 0.75rem;
}

.chat-panel__aux .chat-panel__content {
  margin-top: 6px;
  opacity: 0.85;
  font-size: 0.8rem;
}

.chat-panel__muted {
  margin: 0;
  color: var(--muted);
  font-size: 0.86rem;
}

.chat-panel__thinking {
  margin: 0;
  color: var(--muted);
  font-size: 0.8rem;
  font-style: italic;
}

/* --- Dock: композер как в AiChatPanel ------------------------------------ */
.chat-panel__dock {
  position: relative;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: auto;
  padding: 0 8px 8px;
}

/* Мягкая маска: сообщения «уходят» под композер, а не обрываются. */
.chat-panel__dock::before {
  content: "";
  position: absolute;
  inset-inline: 0;
  top: -18px;
  height: 18px;
  background: linear-gradient(to top, var(--panel), transparent);
  pointer-events: none;
}

.chat-panel__composer {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
}

.chat-panel__composer-box {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  padding: 6px 6px 6px 10px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--panel-2);
}

.chat-panel__composer-box:focus-within {
  border-color: var(--accent);
}

.chat-panel__composer-box.is-recording {
  border-color: var(--danger);
}

.chat-panel__input {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 32px;
  max-height: 88px;
  padding: 6px 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--text);
  font-size: 0.9rem;
  line-height: 1.4;
  resize: none;
  overflow-y: auto;
}

.chat-panel__input:focus {
  outline: none;
}

.chat-panel__icon-btn {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.chat-panel__icon-btn:hover:not(:disabled) {
  color: var(--text);
  background: color-mix(in srgb, var(--text) 8%, transparent);
}

.chat-panel__icon-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.chat-panel__mic.is-listening,
.chat-panel__mic.is-listening:hover:not(:disabled) {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 16%, transparent);
  animation: gena-mic-pulse 1.4s ease-in-out infinite;
}

@keyframes gena-mic-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--danger) 45%, transparent);
  }
  50% {
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--danger) 0%, transparent);
  }
}

.chat-panel__send {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--panel);
  color: var(--text);
  cursor: pointer;
}

.chat-panel__send.is-primary {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
}

.chat-panel__send:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.chat-panel__recording {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 0;
  padding: 6px 12px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--danger) 12%, var(--panel));
  color: var(--danger);
  font-size: 0.78rem;
  font-weight: 600;
}

.chat-panel__recording-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--danger);
  animation: gena-recording-dot 1.2s ease-in-out infinite;
}

@keyframes gena-recording-dot {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.25;
  }
}

.chat-panel__warning {
  margin: 0;
  color: var(--danger);
  font-size: 0.78rem;
}

.chat-panel__notice {
  margin: 0;
  color: var(--ok);
  font-size: 0.75rem;
}

.chat-panel__link {
  padding: 0 4px;
  border: 0;
  background: none;
  color: var(--accent);
  font-size: inherit;
  text-decoration: underline;
  cursor: pointer;
}

@media (max-width: 720px) {
  .chat-panel {
    height: calc(var(--app-vvh, 100vh) - 118px);
    border-radius: 0;
    border-inline: 0;
  }
  .chat-panel__messages {
    padding: 6px 6px 0;
  }
  .chat-panel__message-actions {
    opacity: 1;
  }
  .chat-panel__tool {
    width: 36px;
    height: 36px;
  }
  .chat-panel__dock {
    padding-bottom: calc(8px + env(safe-area-inset-bottom));
  }
  .chat-panel__message--user {
    margin-inline-start: 1rem;
  }
}

/* --- Пустое состояние: стартеры ------------------------------------------ */
.chat-panel__empty {
  margin: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 16px;
  text-align: center;
}

.chat-panel__empty-text,
.chat-panel__empty-title {
  margin: 0;
  color: var(--muted);
  font-size: 0.84rem;
}

.chat-panel__empty-title {
  font-size: 0.72rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.chat-panel__starters {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
}

.chat-panel__starter {
  padding: 6px 10px;
  border-radius: 999px;
  background: var(--panel-2);
  color: var(--text);
  font-size: 0.8rem;
}

.chat-panel__starter:hover:not(:disabled) {
  border-color: var(--accent);
}

/* --- Вложения ------------------------------------------------------------ */
.chat-panel__file {
  display: none;
}

.chat-panel__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chat-panel__chip {
  position: relative;
  width: 56px;
  height: 56px;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--panel-2);
}

.chat-panel__chip img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.chat-panel__chip-remove {
  position: absolute;
  top: 2px;
  inset-inline-end: 2px;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(13, 17, 23, 0.72);
  color: #fff;
  font-size: 13px;
  line-height: 1;
}

.chat-panel__images {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  max-width: 20rem;
}

.chat-panel__images[data-count="1"] {
  grid-template-columns: minmax(0, 1fr);
}

.chat-panel__image {
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--panel-2);
  aspect-ratio: 4 / 3;
}

.chat-panel__image img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.chat-panel__lightbox {
  position: fixed;
  inset: 0;
  z-index: 9998;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.82);
}

.chat-panel__lightbox img {
  max-width: 100%;
  max-height: 100%;
  border-radius: 8px;
  object-fit: contain;
}

</style>
