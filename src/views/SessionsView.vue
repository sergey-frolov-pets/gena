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
  mergeAgents,
  mergeSessions,
  mergeMessages,
} from "@/storage/backup";
import {
  listMessages,
  listAgents,
  listSessions,
  putAgent,
  putMessage,
  putSession,
} from "@/storage/db";
import { clearAll, clearExcept } from "@/storage/cleanup";
import { useLocale } from "@/i18n";
import type { Message, Session } from "@/storage/types";

const { t, locale } = useLocale();

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

function formatDate(value: number): string {
  return new Date(value).toLocaleString(locale.value);
}

/** Собрать и скачать бэкап указанных диалогов: открытый JSON, без ключей агентов. */
async function saveBackup(targetSessions: Session[]): Promise<{ sessions: number; messages: number }> {
  const targetIds = new Set(targetSessions.map((s) => s.id));
  const allMessages: Message[] = [];
  for (const session of targetSessions) {
    const msgs = await listMessages(session.id);
    allMessages.push(...msgs.filter((m) => targetIds.has(m.sessionId)));
  }

  const agentIds = new Set(targetSessions.map((s) => s.agentId));
  const payload = buildBackup({
    agents: agents.value.filter((a) => agentIds.has(a.id)),
    sessions: targetSessions,
    messages: allMessages,
  });

  const blob = new Blob([serializeBackup(payload)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `gena-backup-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);

  return { sessions: targetSessions.length, messages: allMessages.length };
}

async function exportBackup(): Promise<void> {
  error.value = "";
  notice.value = "";
  try {
    const targetSessions = onlySelectedForBackup.value
      ? sessions.value.filter((s) => selectedSessionIds.value.has(s.id))
      : sessions.value;
    const counts = await saveBackup(targetSessions);
    notice.value = t("sessions.backup.exported", counts);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

/** Экспорт одного диалога (P2.2). */
async function exportSession(session: Session): Promise<void> {
  error.value = "";
  notice.value = "";
  try {
    const counts = await saveBackup([session]);
    notice.value = t("sessions.backup.exported", counts);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

async function importBackup(event: Event): Promise<void> {
  error.value = "";
  notice.value = "";
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const payload = parseBackup(text);

    const currentAgents = await listAgents();
    const currentSessions = await listSessions();
    const currentMessages: Message[] = [];
    for (const session of currentSessions) {
      currentMessages.push(...(await listMessages(session.id)));
    }

    const agentsMerge = mergeAgents(currentAgents, payload.agents);
    const sessionsMerge = mergeSessions(currentSessions, payload.sessions);
    const messagesMerge = mergeMessages(currentMessages, payload.messages);

    for (const agent of agentsMerge.toWrite) await putAgent(agent);
    for (const session of sessionsMerge.toWrite) await putSession(session);
    for (const message of messagesMerge.toWrite) await putMessage(message);

    await loadSessions();

    const skipped = sessionsMerge.skipped + messagesMerge.skipped;
    const parts = [
      t("sessions.backup.importedAgents", {
        added: agentsMerge.added,
        updated: agentsMerge.updated,
      }),
      t("sessions.backup.importedSessions", { added: sessionsMerge.added }),
      t("sessions.backup.importedMessages", { added: messagesMerge.added }),
    ];
    if (skipped > 0) parts.push(t("sessions.backup.importedSkipped", { count: skipped }));
    notice.value = t("sessions.backup.imported", { parts: parts.join(", ") });
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
    notice.value = t("sessions.cleanup.removed", {
      sessions: result.removedSessions,
      messages: result.removedMessages,
      kept: keep.length,
    });
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

/** Очистка: удалить все сессии (агенты сохраняются). */
async function cleanupAll(): Promise<void> {
  error.value = "";
  notice.value = "";
  if (!confirmClearAll.value) {
    error.value = t("sessions.cleanup.needConfirm");
    return;
  }
  try {
    const result = await clearAll(false);
    await loadSessions();
    clearSessionSelection();
    confirmClearAll.value = false;
    notice.value = t("sessions.cleanup.removedAll", {
      sessions: result.removedSessions,
      messages: result.removedMessages,
    });
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}
</script>

<template>
  <section>
    <h2>{{ t("sessions.title") }}</h2>

    <div class="toolbar">
      <button @click="toggleAll">
        {{ allSelected ? t("sessions.deselectAll") : t("sessions.selectAll") }}
      </button>
      <span class="muted">
        {{ t("sessions.selected", { count: selectedSessionIds.size, total: sessions.length }) }}
      </span>
    </div>

    <p v-if="sessions.length === 0" class="muted">{{ t("sessions.empty") }}</p>
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
              {{
                t("sessions.item", {
                  agent: agentName(s.agentId),
                  count: s.messageCount,
                  date: formatDate(s.updatedAt),
                })
              }}
            </span>
          </span>
        </label>
        <button
          type="button"
          class="link"
          :aria-label="t('sessions.backup.export')"
          :title="t('sessions.backup.export')"
          @click="exportSession(s)"
        >
          {{ t("sessions.backup.export") }}
        </button>
      </li>
    </ul>

    <div class="card">
      <h3>{{ t("sessions.backup.title") }}</h3>
      <p class="muted small">{{ t("sessions.backup.intro") }}</p>
      <label class="check">
        <input v-model="onlySelectedForBackup" type="checkbox" />
        <span>{{ t("sessions.backup.onlySelected") }}</span>
      </label>
      <div class="actions">
        <button class="primary" @click="exportBackup">{{ t("sessions.backup.export") }}</button>
        <label class="file-btn">
          {{ t("sessions.backup.import") }}
          <input type="file" accept="application/json,.json" @change="importBackup" />
        </label>
      </div>
    </div>

    <div class="card danger-zone">
      <h3>{{ t("sessions.cleanup.title") }}</h3>
      <div class="actions">
        <button @click="cleanupExceptSelected">
          {{ t("sessions.cleanup.exceptSelected", { count: selectedSessionIds.size }) }}
        </button>
      </div>
      <div class="actions">
        <label class="check">
          <input v-model="confirmClearAll" type="checkbox" />
          <span>{{ t("sessions.cleanup.confirmAll") }}</span>
        </label>
        <button class="danger" @click="cleanupAll">{{ t("sessions.cleanup.deleteAll") }}</button>
      </div>
      <p class="muted small">{{ t("sessions.cleanup.agentsKept") }}</p>
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
}
.list .link {
  flex: 0 0 auto;
  background: none;
  border: 0;
  padding: 4px 6px;
  color: var(--accent);
  cursor: pointer;
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
