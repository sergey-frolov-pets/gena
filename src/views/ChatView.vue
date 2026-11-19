<script setup lang="ts">
import { computed, ref } from "vue";
import {
  agents,
  appendMessage,
  createSession,
  getAgentKey,
  loadMessages,
  messages,
  activeSessionId,
  sessions,
} from "@/lib/store";
import { sendToAgent } from "@/lib/agent-client";
import type { Session } from "@/storage/types";

const agentId = ref("");
const draft = ref("");
const busy = ref(false);
const error = ref("");

const agentSessions = computed<Session[]>(() =>
  sessions.value.filter((s) => !agentId.value || s.agentId === agentId.value),
);

const activeSession = computed<Session | undefined>(() =>
  sessions.value.find((s) => s.id === activeSessionId.value),
);

async function newSession(): Promise<void> {
  error.value = "";
  if (!agentId.value) {
    error.value = "Выберите агента";
    return;
  }
  const session = await createSession(agentId.value, "Новый диалог");
  await loadMessages(session.id);
}

async function openSession(id: string): Promise<void> {
  await loadMessages(id);
}

async function send(): Promise<void> {
  error.value = "";
  const text = draft.value.trim();
  if (!text || busy.value) return;

  const session = activeSession.value;
  if (!session) {
    error.value = "Сначала создайте или откройте сессию";
    return;
  }
  const agent = agents.value.find((a) => a.id === session.agentId);
  if (!agent) {
    error.value = "Агент сессии не найден";
    return;
  }

  busy.value = true;
  try {
    await appendMessage(session.id, "user", text);
    draft.value = "";

    const key = await getAgentKey(agent);
    const history = messages.value.filter((m) => m.role !== "system");
    const response = await sendToAgent(agent, key, {
      message: text,
      sessionId: session.id,
      settings: agent.settings,
      history,
    });
    await appendMessage(session.id, "assistant", response.reply);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="chat">
    <div class="sidebar">
      <div class="field">
        <label>Агент</label>
        <select v-model="agentId">
          <option value="">— выберите —</option>
          <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.name }}</option>
        </select>
      </div>
      <button class="primary" :disabled="!agentId" @click="newSession">Новый диалог</button>

      <h4>Диалоги</h4>
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
      <h3 v-if="activeSession">{{ activeSession.title }}</h3>
      <h3 v-else class="muted">Выберите или создайте диалог</h3>

      <div class="messages">
        <div v-for="m in messages" :key="m.id" class="msg" :class="m.role">
          <div class="role muted small">{{ m.role }}</div>
          <div class="body">{{ m.content }}</div>
        </div>
        <p v-if="messages.length === 0" class="muted">Сообщений пока нет.</p>
      </div>

      <form class="composer" @submit.prevent="send">
        <textarea
          v-model="draft"
          rows="2"
          placeholder="Сообщение… (Enter — отправить)"
          :disabled="busy || !activeSession"
          @keydown.enter.exact.prevent="send"
        />
        <button class="primary" type="submit" :disabled="busy || !activeSession">
          {{ busy ? "…" : "Отправить" }}
        </button>
      </form>
      <p v-if="error" class="error">{{ error }}</p>
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
.msg .body {
  white-space: pre-wrap;
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
</style>
