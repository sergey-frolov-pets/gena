<script setup lang="ts">
/**
 * Чат Gena. Разметка и стили — порт `AiChatPanel` из code2graph
 * (toolbar → stage с пузырями → dock с композером), данные и транспорт — Gena.
 * Голос: диктовка (Web Speech) и озвучка ответов (Speech Synthesis).
 */
import { computed, nextTick, ref, watch } from "vue";
import {
  activeSessionId,
  agents,
  appendMessage,
  createSession,
  getAgentKey,
  loadMessages,
  messages,
  renameSession,
  sessions,
} from "@/lib/store";
import { sendToAgent } from "@/lib/agent-client";
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
import type { Session } from "@/storage/types";

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

const agentSessions = computed<Session[]>(() =>
  sessions.value.filter((s) => !agentId.value || s.agentId === agentId.value),
);

const filteredSessions = computed<Session[]>(() => {
  const query = historyQuery.value.trim().toLowerCase();
  if (!query) return agentSessions.value;
  return agentSessions.value.filter((s) => s.title.toLowerCase().includes(query));
});

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
  () => Boolean(activeSession.value) && draft.value.trim().length > 0 && !busy.value,
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
  if (!text || busy.value) return;

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

  const limit = agent.settings.callLimit;
  if (limit > 0 && !(await canCall(agent.id, limit))) {
    error.value = t("chat.error.limitReached", { limit });
    await refreshUsage();
    return;
  }

  stopDictation();
  lastText.value = text;
  busy.value = true;
  streamingText.value = "";
  const controller = new AbortController();
  abortCtrl.value = controller;
  try {
    await appendMessage(session.id, "user", text);
    draft.value = "";

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
    const reply = await appendMessage(session.id, "assistant", response.reply);
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
      <div v-if="historyOpen" class="chat-panel__history">
        <input
          v-model="historyQuery"
          class="chat-panel__search"
          type="search"
          :placeholder="t('chat.dialogs')"
          :aria-label="t('chat.dialogs')"
        />
        <p v-if="filteredSessions.length === 0" class="chat-panel__muted">
          {{ t("chat.selectOrCreate") }}
        </p>
        <ul class="chat-panel__session-list">
          <li
            v-for="s in filteredSessions"
            :key="s.id"
            class="chat-panel__session"
            :class="{ 'is-active': s.id === activeSessionId }"
          >
            <button class="chat-panel__session-open" type="button" @click="openSession(s.id)">
              <span class="chat-panel__session-title">{{ s.title }}</span>
              <span class="chat-panel__session-count">{{ s.messageCount }}</span>
            </button>
          </li>
        </ul>
      </div>

      <div ref="messagesEl" class="chat-panel__messages" role="log" aria-live="polite">
        <template v-for="m in messages" :key="m.id">
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
            <p class="chat-panel__content">{{ m.content }}</p>
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
            </div>
          </article>
        </template>

        <article v-if="streamingText" class="chat-panel__message chat-panel__message--assistant">
          <span class="chat-panel__role">{{ t("chat.role.assistant") }}</span>
          <p class="chat-panel__content">{{ streamingText }}</p>
        </article>

        <p v-if="messages.length === 0 && !typing && !streamingText" class="chat-panel__muted">
          {{ t("chat.messagesEmpty") }}
        </p>
        <p v-if="typing" class="chat-panel__thinking">{{ t("chat.typing") }}</p>
      </div>
    </div>

    <div class="chat-panel__dock">
      <p v-if="dictationListening" class="chat-panel__recording" role="status" aria-live="polite">
        <span class="chat-panel__recording-dot" aria-hidden="true" />
        {{ t("chat.dictateRecording") }}
      </p>
      <p v-if="dictationMessage" class="chat-panel__warning" role="alert">{{ dictationMessage }}</p>
      <p v-if="error" class="chat-panel__warning" role="alert">
        {{ error }}
        <button v-if="lastText" type="button" class="chat-panel__link" @click="retry">
          {{ t("chat.retry") }}
        </button>
      </p>
      <p v-if="notice" class="chat-panel__notice" role="status">{{ notice }}</p>

      <form class="chat-panel__composer" @submit.prevent="send">
        <div class="chat-panel__composer-box" :class="{ 'is-recording': dictationListening }">
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
  </section>
</template>

<style scoped>
/* --- Каркас: как .ai-chat-panel ------------------------------------------- */
.chat-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  height: calc(100vh - 132px);
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--panel);
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

.chat-panel__history {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  overflow-y: auto;
  background: var(--panel);
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
  padding: 12px;
  overflow-y: auto;
}

/* --- Пузыри: как .ai-chat-panel__message --------------------------------- */
.chat-panel__message {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: min(100%, 36rem);
  padding: 6px 12px 8px;
  border-radius: 12px;
}

.chat-panel__message--user {
  align-self: flex-end;
  margin-inline-start: 2rem;
  background: color-mix(in srgb, var(--accent) 14%, var(--panel));
  border-end-end-radius: 4px;
}

.chat-panel__message--assistant {
  align-self: flex-start;
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
  padding: 0 10px 10px;
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
  width: 32px;
  height: 32px;
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
    height: calc(100vh - 118px);
    border-radius: 0;
    border-inline: 0;
  }
  .chat-panel__messages {
    padding: 10px;
  }
  .chat-panel__message-actions {
    opacity: 1;
  }
  .chat-panel__message--user {
    margin-inline-start: 1rem;
  }
}
</style>
