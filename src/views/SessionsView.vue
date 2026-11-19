<script setup lang="ts">
import { computed, ref } from "vue";
import {
  agents,
  sessions,
  selectedSessionIds,
  toggleSessionSelected,
  clearSessionSelection,
  loadSessions,
} from "@/lib/store";
import {
  buildBackup,
  serializeBackup,
  parseBackup,
  backupAgentToAgent,
} from "@/storage/backup";
import { listMessages, putAgent, putMessage, putSession } from "@/storage/db";
import { clearAll, clearExcept } from "@/storage/cleanup";

const error = ref("");
const notice = ref("");
const onlySelectedForBackup = ref(false);
const confirmClearAll = ref(false);

const allSelected = computed(
  () => sessions.value.length > 0 && selectedSessionIds.value.size === sessions.value.length,
);

function toggleAll(): void {
  if (allSelected.value) {
    clearSessionSelection();
  } else {
    selectedSessionIds.value = new Set(sessions.value.map((s) => s.id));
  }
}

function agentName(agentId: string): string {
  return agents.value.find((a) => a.id === agentId)?.name ?? "—";
}

/** Экспорт: открытый JSON, без ключей агентов. */
async function exportBackup(): Promise<void> {
  error.value = "";
  notice.value = "";
  try {
    const targetSessions = onlySelectedForBackup.value
      ? sessions.value.filter((s) => selectedSessionIds.value.has(s.id))
      : sessions.value;

    const targetIds = new Set(targetSessions.map((s) => s.id));
    const allMessages = [];
    for (const session of targetSessions) {
      const msgs = await listMessages(session.id);
      allMessages.push(...msgs.filter((m) => targetIds.has(m.sessionId)));
    }

    const agentIds = new Set(targetSessions.map((s) => s.agentId));
    const targetAgents = agents.value.filter((a) => agentIds.has(a.id));

    const payload = buildBackup({
      agents: targetAgents,
      sessions: targetSessions,
      messages: allMessages,
    });
    const json = serializeBackup(payload);

    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `gena-backup-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);

    notice.value = `Экспортировано: ${targetSessions.length} сессий, ${allMessages.length} сообщений. Ключи агентов и пароли в файл не попадают.`;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

/** Импорт: добавить/перезаписать сессии из файла. Ключи не восстанавливаются. */
async function importBackup(event: Event): Promise<void> {
  error.value = "";
  notice.value = "";
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const payload = parseBackup(text);

    for (const backupAgent of payload.agents) {
      await putAgent(backupAgentToAgent(backupAgent));
    }
    for (const session of payload.sessions) {
      await putSession(session);
    }
    for (const message of payload.messages) {
      await putMessage(message);
    }
    await loadSessions();
    notice.value = `Импортировано: ${payload.sessions.length} сессий, ${payload.messages.length} сообщений. Ключи агентов нужно ввести заново.`;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    input.value = "";
  }
}

/** Очистка: удалить всё, кроме отмеченных. */
async function cleanupExceptSelected(): Promise<void> {
  error.value = "";
  notice.value = "";
  try {
    const keep = [...selectedSessionIds.value];
    const result = await clearExcept(keep);
    await loadSessions();
    clearSessionSelection();
    notice.value = `Удалено: ${result.removedSessions} сессий, ${result.removedMessages} сообщений. Сохранено ${keep.length}.`;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

/** Очистка: удалить все сессии (агенты сохраняются). */
async function cleanupAll(): Promise<void> {
  error.value = "";
  notice.value = "";
  if (!confirmClearAll.value) {
    error.value = "Отметьте подтверждение, чтобы удалить всё";
    return;
  }
  try {
    const result = await clearAll(false);
    await loadSessions();
    clearSessionSelection();
    confirmClearAll.value = false;
    notice.value = `Удалено всё: ${result.removedSessions} сессий, ${result.removedMessages} сообщений.`;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}
</script>

<template>
  <section>
    <h2>Сессии и данные</h2>

    <div class="toolbar">
      <button @click="toggleAll">
        {{ allSelected ? "Снять все" : "Выбрать все" }}
      </button>
      <span class="muted">Выбрано: {{ selectedSessionIds.size }} из {{ sessions.length }}</span>
    </div>

    <p v-if="sessions.length === 0" class="muted">Сессий нет.</p>
    <ul class="list">
      <li v-for="s in sessions" :key="s.id">
        <label class="check">
          <input
            type="checkbox"
            :checked="selectedSessionIds.has(s.id)"
            @change="toggleSessionSelected(s.id)"
          />
          <span>
            <strong>{{ s.title }}</strong>
            <span class="muted small">
              · {{ agentName(s.agentId) }} · {{ s.messageCount }} сообщ. ·
              {{ new Date(s.updatedAt).toLocaleString() }}
            </span>
          </span>
        </label>
      </li>
    </ul>

    <div class="card">
      <h3>Бэкап истории</h3>
      <p class="muted small">
        Экспорт — открытый JSON. В файл <strong>не попадают ключи агентов и пароли</strong>:
        только сессии, сообщения и настройки агентов (адрес, модель, лимиты). Ключ агента после
        импорта вводится заново.
      </p>
      <label class="check">
        <input v-model="onlySelectedForBackup" type="checkbox" />
        <span>Экспортировать только отмеченные сессии</span>
      </label>
      <div class="actions">
        <button class="primary" @click="exportBackup">Экспорт в файл</button>
        <label class="file-btn">
          Импорт из файла
          <input type="file" accept="application/json,.json" @change="importBackup" />
        </label>
      </div>
    </div>

    <div class="card danger-zone">
      <h3>Очистка IndexedDB</h3>
      <div class="actions">
        <button @click="cleanupExceptSelected">
          Удалить всё, кроме отмеченных ({{ selectedSessionIds.size }})
        </button>
      </div>
      <div class="actions">
        <label class="check">
          <input v-model="confirmClearAll" type="checkbox" />
          <span>Подтверждаю удаление всех сессий</span>
        </label>
        <button class="danger" @click="cleanupAll">Удалить все сессии</button>
      </div>
      <p class="muted small">Агенты при очистке сохраняются.</p>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="notice" class="ok">{{ notice }}</p>
  </section>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.list {
  list-style: none;
  padding: 0;
  margin: 0 0 20px;
}
.list li {
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
}
.check {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text);
  margin: 0;
  cursor: pointer;
}
.check input {
  width: auto;
}
.card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
}
.actions {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-top: 10px;
  flex-wrap: wrap;
}
.file-btn {
  display: inline-block;
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-2);
  cursor: pointer;
  color: var(--text);
}
.file-btn input {
  display: none;
}
.small {
  font-size: 12px;
}
.danger-zone {
  border-color: var(--danger);
}
</style>
