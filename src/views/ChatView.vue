<script setup lang="ts">
import { computed, ref, watch, nextTick } from "vue";
import {
  agents,
  appendMessage,
  createSession,
  getAgentKey,
  loadMessages,
  messages,
  activeSessionId,
  sessions,
  renameSession,
} from "@/lib/store";
import { sendToAgent } from "@/lib/agent-client";
import { describeError } from "@/lib/errors";
import { canCall, getCallCount, recordCall } from "@/storage/usage";
import { useLocale } from "@/i18n";
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
/** Накопленный текст стриминга (показывается живым, до сохранения ответа). */
const streamingText = ref("");
/** Ссылка на контейнер сообщений — для автоскролла. */
const messagesEl = ref<HTMLElement | null>(null);
/** Режим переименования диалога в шапке. */
const renaming = ref(false);
const renameDraft = ref("");

const agentSessions = computed<Session[]>(() =>
  sessions.value.filter((s) => !agentId.value || s.agentId === agentId.value),
);

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

async function refreshUsage(): Promise<void> {
  const agent = activeAgent.value;
  if (!agent) {
    usedToday.value = 0;
    return;
  }
  usedToday.value = await getCallCount(agent.id);
}

watch([agentId, activeSessionId, agents], refreshUsage, { immediate: true });

/** Прокрутить чат вниз при новых сообщениях, стриминге или индикаторе набора. */
async function scrollToBottom(): Promise<void> {
  await nextTick();
  if (messagesEl.value) {
    messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
  }
}
watch([messages, streamingText, typing], scrollToBottom);

async function newSession(): Promise<void> {
  error.value = "";
  notice.value = "";
  if (!agentId.value) {
    error.value = t("chat.error.chooseAgent");
    return;
  }
  const session = await createSession(agentId.value, t("chat.newDialogTitle"));
  await loadMessages(session.id);
}

async function openSession(id: string): Promise<void> {
  await loadMessages(id);
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

  // Предупреждение о незаданном ключе — до отправки.
  if (!agent.sealedKey) {
    error.value = t("chat.error.noKey");
    return;
  }

  // Дневной лимит вызовов.
  const limit = agent.settings.callLimit;
  if (limit > 0 && !(await canCall(agent.id, limit))) {
    error.value = t("chat.error.limitReached", { limit });
    await refreshUsage();
    return;
  }

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
    await appendMessage(session.id, "assistant", response.reply);
    await recordCall(agent.id);
    await refreshUsage();
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

function startRename(): void {
  renameDraft.value = activeSession.value?.title ?? "";
  renaming.value = true;
}

async function commitRename(): Promise<void> {
  const session = activeSession.value;
  if (!session) {
    renaming.value = false;
    return;
  }
  await renameSession(session.id, renameDraft.value);
  renaming.value = false;
}

function protocolLabel(): string {
  const p = activeAgent.value?.protocol ?? "http_json";
  return t(("connections.protocol." + p) as never);
}
</script>

<template>
  <section class="chat">
    <div class="sidebar">
      <div class="field">
        <label>{{ t("chat.agent") }}</label>
        <select v-model="agentId">
          <option value="">{{ t("chat.selectAgent") }}</option>
          <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.name }}</option>
        </select>
      </div>
      <button class="primary" :disabled="!agentId" @click="newSession">
        {{ t("chat.newDialog") }}
      </button>

      <h4>{{ t("chat.dialogs") }}</h4>
      <ul class="sessions">
        <li
          v-for="s in agentSessions"
          :key="s.id"
          :class="{ active: s.id === activeSessionId }"
          @click="openSession(s.id)"
        >
          {{ s.title }}
          <span class="muted small">{{ s.messageCount }}</span>
        </li>
      </ul>
    </div>

    <div class="main">
      <div class="chat-head">
        <template v-if="renaming && activeSession">
          <input
            v-model="renameDraft"
            class="rename-input"
            :aria-label="t('chat.renamePlaceholder')"
            @keydown.enter.prevent="commitRename"
            @keydown.esc.prevent="renaming = false"
          />
          <button type="button" class="primary" @click="commitRename">
            {{ t("chat.rename") }}
          </button>
          <button type="button" @click="renaming = false">
            {{ t("connections.cancelEdit") }}
          </button>
        </template>
        <template v-else>
          <h3 v-if="activeSession">{{ activeSession.title }}</h3>
          <h3 v-else class="muted">{{ t("chat.selectOrCreate") }}</h3>
          <button
            v-if="activeSession"
            type="button"
            class="link"
            :aria-label="t('chat.rename')"
            @click="startRename"
          >
            ✎
          </button>
          <span v-if="activeAgent" class="badge">{{ protocolLabel() }}</span>
        </template>
      </div>
      <p v-if="limitLabel" class="muted small usage">{{ limitLabel }}</p>

      <div ref="messagesEl" class="messages" role="log" aria-live="polite">
        <div
          v-for="m in messages"
          :key="m.id"
          class="msg"
          :class="[m.role, m.kind === 'thought' || m.kind === 'tool_calls' ? 'aux' : '']"
        >
          <details v-if="m.kind === 'thought'" class="aux-block thought">
            <summary>{{ t("chat.thought") }}</summary>
            <div class="body">{{ m.content }}</div>
          </details>
          <details v-else-if="m.kind === 'tool_calls'" class="aux-block toolcalls">
            <summary>{{ t("chat.toolCalls") }}</summary>
            <div class="body">{{ m.content }}</div>
          </details>
          <template v-else>
            <div class="role muted small">{{ t(`chat.role.${m.role}` as never) }}</div>
            <div class="body">{{ m.content }}</div>
          </template>
        </div>
        <div v-if="streamingText" class="msg assistant">
          <div class="role muted small">{{ t("chat.role.assistant") }}</div>
          <div class="body">{{ streamingText }}</div>
        </div>
        <p v-if="messages.length === 0 && !typing && !streamingText" class="muted">
          {{ t("chat.messagesEmpty") }}
        </p>
        <p v-if="typing" class="muted small typing">{{ t("chat.typing") }}</p>
      </div>

      <form class="composer" @submit.prevent="send">
        <textarea
          v-model="draft"
          rows="2"
          :placeholder="t('chat.composerPlaceholder')"
          :aria-label="t('chat.composerPlaceholder')"
          :disabled="busy || !activeSession"
          @keydown.enter.exact.prevent="send"
        />
        <button class="primary" type="submit" :disabled="busy || !activeSession">
          {{ busy ? "…" : t("chat.send") }}
        </button>
        <button v-if="busy" type="button" class="danger" @click="stop">
          {{ t("chat.stop") }}
        </button>
      </form>
      <p v-if="error" class="error" role="alert">
        {{ error }}
        <button v-if="lastText" type="button" class="link" @click="retry">
          {{ t("chat.retry") }}
        </button>
      </p>
      <p v-if="notice" class="ok" role="status">{{ notice }}</p>
    </div>
  </section>
</template>

<style scoped>
.chat {
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: 16px;
  height: calc(100vh - 140px);
}
.sidebar {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px;
  overflow-y: auto;
}
.sessions {
  list-style: none;
  padding: 0;
  margin: 8px 0 0;
}
.sessions li {
  padding: 8px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.sessions li:hover {
  background: var(--panel-2);
}
.sessions li.active {
  background: var(--accent);
  color: #fff;
}
.main {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.chat-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.chat-head h3 {
  margin: 0;
}
.rename-input {
  flex: 1;
  min-width: 0;
}
.link {
  background: none;
  border: none;
  color: var(--accent);
  cursor: pointer;
  padding: 0 4px;
  font-size: 14px;
}
.badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  white-space: nowrap;
}
.usage {
  margin: 4px 0 8px;
}
.messages {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}
.msg {
  margin-bottom: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--panel);
  border: 1px solid var(--border);
}
.msg.user {
  border-color: var(--accent);
}
.msg.aux {
  background: transparent;
  border-style: dashed;
}
.msg .body {
  white-space: pre-wrap;
}
.aux-block summary {
  cursor: pointer;
  font-size: 12px;
  color: var(--muted);
}
.aux-block .body {
  margin-top: 6px;
  font-size: 13px;
  opacity: 0.85;
}
.typing {
  font-style: italic;
}
.small {
  font-size: 12px;
}
.composer {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}
.composer textarea {
  flex: 1;
  resize: vertical;
}
.error .link {
  margin-left: 8px;
  background: none;
  border: none;
  color: var(--accent);
  cursor: pointer;
  text-decoration: underline;
  padding: 0;
}
</style>
