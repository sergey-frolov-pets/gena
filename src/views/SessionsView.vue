<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  agents,
  sessions,
  selectedSessionIds,
  toggleSessionSelected,
  clearSessionSelection,
  loadSessions,
  setSessionTags,
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
import { measureStorage, type StorageSizes } from "@/storage/sizes";
import { formatSize } from "@/lib/sizes";
import { useLocale } from "@/i18n";
import { useAgentFilter } from "@/composables/useAgentFilter";
import { sortSessions } from "@/lib/session-list";
import { collectTags, filterByTag } from "@/lib/session-tags";
import { readModelPrices } from "@/lib/provider-account";
import { sessionCostLabel } from "@/lib/session-cost";
import type { Message, Session } from "@/storage/types";
import ConfirmModal from "@/components/ConfirmModal.vue";
import SessionTagsDialog from "@/components/SessionTagsDialog.vue";

const { t, locale } = useLocale();

const error = ref("");
const notice = ref("");
const onlySelectedForBackup = ref(false);

/** Какое подтверждение сейчас показано в модалке. */
type CleanupMode = "" | "all" | "except";
const confirmMode = ref<CleanupMode>("");

/** Размеры данных: считаются только по кнопке, до этого в списке прочерк. */
const sizes = ref<StorageSizes | null>(null);
const measuring = ref(false);

async function recalcSizes(): Promise<void> {
  error.value = "";
  measuring.value = true;
  try {
    sizes.value = await measureStorage();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    measuring.value = false;
  }
}

/** Стоимость сессии, если известны и токены, и тариф модели. */
const costs = ref<Record<string, string>>({});

function modelOf(agentId: string): string {
  const agent = agents.value.find((item) => item.id === agentId);
  if (!agent) return "";
  const config = agent.config as { model?: string } | undefined;
  return (config?.model || agent.settings.llmModel || "").trim();
}

async function loadCosts(): Promise<void> {
  const prices = readModelPrices();
  const next: Record<string, string> = {};
  if (Object.keys(prices).length > 0) {
    for (const session of sessions.value) {
      const messages = await listMessages(session.id);
      const label = sessionCostLabel(messages, prices, modelOf(session.agentId));
      if (label) next[session.id] = label;
    }
  }
  costs.value = next;
}

onMounted(() => {
  void loadCosts();
});

watch(sessions, () => {
  void loadCosts();
});

/** Размер одной сессии (всё вместе: запись + сообщения) или пустая строка. */
function sessionSize(sessionId: string): string {
  const entry = sizes.value?.sessions[sessionId];
  return entry ? formatSize(entry.totalBytes) : "";
}

/** Общий размер базы (агенты + сессии + сообщения). */
const totalSize = computed(() => (sizes.value ? formatSize(sizes.value.totalBytes) : "—"));

/** Разбивка по видам записей. */
const sizeBreakdown = computed(() =>
  sizes.value
    ? t("sessions.size.breakdown", {
        agents: formatSize(sizes.value.agentBytes),
        sessions: formatSize(sizes.value.sessionBytes),
        messages: formatSize(sizes.value.messageBytes),
      })
    : "",
);

const confirmTitle = computed(() =>
  confirmMode.value === "all"
    ? t("sessions.cleanup.deleteAll")
    : t("sessions.cleanup.exceptSelected", { count: selectedSessionIds.value.size }),
);

const confirmMessage = computed(() =>
  confirmMode.value === "all"
    ? t("sessions.cleanup.confirmAllText")
    : t("sessions.cleanup.confirmExceptText", { keep: selectedSessionIds.value.size }),
);

/** Фильтр по агенту (чипы): список, «выбрать все» и счётчики идут по нему. */
const {
  filter: agentFilter,
  agentsInUse: filterAgents,
  filtered: sessionsOfAgent,
} = useAgentFilter(sessions, agents);

/** Фильтр по тегу — второй ряд чипов; теги берём из самих диалогов. */
const tagFilter = ref("");
const tagsInUse = computed(() => collectTags(sessions.value));

/** Видимый список: агент → тег → порядок (закреплённые сверху, свежие первыми). */
const visibleSessions = computed(() =>
  sortSessions(filterByTag(sessionsOfAgent.value, tagFilter.value)),
);

// Тег пропал вместе с последним диалогом — снимаем фильтр.
watch(tagsInUse, (list) => {
  if (tagFilter.value && !list.includes(tagFilter.value)) tagFilter.value = "";
});

/** Редактор тегов: диалог и его обработчики. */
const tagsTarget = ref<Session | null>(null);

async function saveTags(tags: string[]): Promise<void> {
  const target = tagsTarget.value;
  tagsTarget.value = null;
  if (!target) return;
  await setSessionTags(target.id, tags);
}

/** Сколько отмечено среди видимых: счётчик не путается с записями под фильтром. */
const selectedVisible = computed(
  () => visibleSessions.value.filter((s) => selectedSessionIds.value.has(s.id)).length,
);

const allSelected = computed(
  () =>
    visibleSessions.value.length > 0 &&
    visibleSessions.value.every((s) => selectedSessionIds.value.has(s.id)),
);

function toggleAll(): void {
  if (allSelected.value) {
    for (const s of visibleSessions.value) {
      if (selectedSessionIds.value.has(s.id)) toggleSessionSelected(s.id);
    }
  } else {
    for (const s of visibleSessions.value) {
      if (!selectedSessionIds.value.has(s.id)) toggleSessionSelected(s.id);
    }
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
    sizes.value = null; // данные изменились — старые размеры недействительны

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
    sizes.value = null; // данные изменились — старые размеры недействительны
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
  try {
    const result = await clearAll(false);
    await loadSessions();
    sizes.value = null; // данные изменились — старые размеры недействительны
    clearSessionSelection();
    notice.value = t("sessions.cleanup.removedAll", {
      sessions: result.removedSessions,
      messages: result.removedMessages,
    });
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

/** Подтверждение в модалке: выполняем выбранную очистку. */
async function runConfirmedCleanup(): Promise<void> {
  const mode = confirmMode.value;
  confirmMode.value = "";
  if (mode === "all") {
    await cleanupAll();
  } else if (mode === "except") {
    await cleanupExceptSelected();
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
        {{ t("sessions.selected", { count: selectedVisible, total: visibleSessions.length }) }}
      </span>
    </div>

    <div class="agent-chips" role="group" :aria-label="t('chat.filterAgent')">
      <button
        type="button"
        class="agent-chip"
        :class="{ 'is-on': !agentFilter }"
        :aria-pressed="!agentFilter"
        @click="agentFilter = ''"
      >
        {{ t("chat.allAgents") }}
      </button>
      <button
        v-for="agent in filterAgents"
        :key="agent.id"
        type="button"
        class="agent-chip"
        :class="{ 'is-on': agentFilter === agent.id }"
        :aria-pressed="agentFilter === agent.id"
        @click="agentFilter = agent.id"
      >
        {{ agent.name }}
      </button>
    </div>

    <div
      v-if="tagsInUse.length > 0"
      class="agent-chips"
      role="group"
      :aria-label="t('chat.tags')"
    >
      <button
        type="button"
        class="agent-chip"
        :class="{ 'is-on': !tagFilter }"
        :aria-pressed="!tagFilter"
        @click="tagFilter = ''"
      >
        {{ t("chat.allTags") }}
      </button>
      <button
        v-for="tag in tagsInUse"
        :key="tag"
        type="button"
        class="agent-chip"
        :class="{ 'is-on': tagFilter === tag }"
        :aria-pressed="tagFilter === tag"
        @click="tagFilter = tag"
      >
        {{ tag }}
      </button>
    </div>

    <p v-if="visibleSessions.length === 0" class="muted">{{ t("sessions.empty") }}</p>
    <ul class="list">
      <li v-for="s in visibleSessions" :key="s.id">
        <label class="check">
          <input
            type="checkbox"
            :checked="selectedSessionIds.has(s.id)"
            @change="toggleSessionSelected(s.id)"
          />
          <span>
            <strong>
              <svg
                v-if="s.pinned"
                class="pin-mark"
                viewBox="0 0 24 24"
                width="13"
                height="13"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                role="img"
                :aria-label="t('chat.pin')"
              >
                <path d="M12 17v5" />
                <path d="M9 3h6l-1 6 3 3H7l3-3z" />
              </svg>{{ s.title }}
            </strong>
            <span v-if="s.tokenMode" class="token-tag">{{ t("sessions.tokenBadge") }}</span>
            <span class="muted small">
              {{
                t("sessions.item", {
                  agent: agentName(s.agentId),
                  count: s.messageCount,
                  date: formatDate(s.updatedAt),
                })
              }}
            </span>
            <span v-if="sessionSize(s.id)" class="muted small">
              {{ t("sessions.size.item", { size: sessionSize(s.id) }) }}
            </span>
            <span v-if="costs[s.id]" class="muted small">
              {{ t("sessions.cost", { cost: costs[s.id] }) }}
            </span>
            <span v-if="s.tags && s.tags.length > 0" class="tag-row">
              <span v-for="tag in s.tags" :key="tag" class="tag-chip">{{ tag }}</span>
            </span>
          </span>
        </label>
        <div class="row-actions">
          <button
            type="button"
            class="link"
            :aria-label="t('chat.tagsEditTitle')"
            :title="t('chat.tagsEditTitle')"
            @click="tagsTarget = s"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
              <circle cx="7" cy="7" r="1" />
            </svg>
          </button>
          <button
            type="button"
            class="link"
            :aria-label="t('sessions.backup.export')"
            :title="t('sessions.backup.export')"
            @click="exportSession(s)"
          >
          {{ t("sessions.backup.export") }}
        </button>
        </div>
      </li>
    </ul>

    <div class="card">
      <h3>{{ t("sessions.size.title") }}</h3>
      <div class="actions">
        <button class="primary" :disabled="measuring" @click="recalcSizes">
          {{ measuring ? t("sessions.size.measuring") : t("sessions.size.recalc") }}
        </button>
        <span class="muted">{{ t("sessions.size.total", { size: totalSize }) }}</span>
      </div>
      <p v-if="sizes" class="muted small">{{ sizeBreakdown }}</p>
      <p v-else class="muted small">{{ t("sessions.size.hint") }}</p>
    </div>

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
        <button :disabled="sessions.length === 0" @click="confirmMode = 'except'">
          {{ t("sessions.cleanup.exceptSelected", { count: selectedSessionIds.size }) }}
        </button>
      </div>
      <div class="actions">
        <button class="danger" :disabled="sessions.length === 0" @click="confirmMode = 'all'">
          {{ t("sessions.cleanup.deleteAll") }}
        </button>
      </div>
      <p class="muted small">{{ t("sessions.cleanup.agentsKept") }}</p>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="notice" class="ok">{{ notice }}</p>

    <ConfirmModal
      :open="confirmMode !== ''"
      :title="confirmTitle"
      :message="confirmMessage"
      :confirm-label="t('sessions.confirm')"
      :cancel-label="t('sessions.cancel')"
      @confirm="runConfirmedCleanup"
      @cancel="confirmMode = ''"
    />

    <SessionTagsDialog
      :open="tagsTarget !== null"
      :session-title="tagsTarget?.title ?? ''"
      :tags="tagsTarget?.tags ?? []"
      :suggestions="tagsInUse"
      @close="tagsTarget = null"
      @save="saveTags"
    />
  </section>
</template>

<style scoped>
.token-tag {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 7px;
  border: 1px solid var(--accent, #2f8f5b);
  border-radius: 999px;
  color: var(--accent, #2f8f5b);
  font-size: 0.7rem;
  line-height: 1.5;
  vertical-align: middle;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
/* Фильтр по агенту: чипы над списком сессий. */
.agent-chips {
  display: flex;
  gap: 6px;
  margin: 0 0 12px;
  overflow-x: auto;
  scrollbar-width: none;
}
.agent-chips::-webkit-scrollbar {
  display: none;
}
.agent-chip {
  flex: 0 0 auto;
  max-width: 12rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--panel);
  color: var(--muted);
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}
.agent-chip.is-on {
  border-color: var(--accent);
  background: var(--panel-2);
  color: var(--text);
  font-weight: 600;
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
.check {
  min-width: 0;
}
.check > span {
  min-width: 0;
}
@media (max-width: 720px) {
  .toolbar {
    flex-wrap: wrap;
  }
  .list li {
    align-items: flex-start;
    gap: 8px;
    padding: 12px 0;
  }
  .check {
    flex: 1 1 auto;
    align-items: flex-start;
  }
  .row-actions {
    margin-top: 2px;
  }
  .list .link {
    min-height: 36px;
    padding: 6px 8px;
  }
  .card {
    padding: 12px;
  }
  .agent-chip {
    min-height: 36px;
    font-size: 0.86rem;
  }
}
.list .link {
  flex: 0 0 auto;
  background: none;
  border: 0;
  padding: 4px 6px;
  color: var(--accent);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
/* Кнопки строки: теги и экспорт — рядом, справа. */
.row-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 2px;
}
/* Закреплённый диалог: метка перед названием. */
.pin-mark {
  vertical-align: -2px;
  margin-inline-end: 4px;
  color: var(--accent, #2f8f5b);
}
/* Теги диалога: второй строкой под данными. */
.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 3px;
}
.tag-chip {
  padding: 0 7px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--muted);
  font-size: 0.68rem;
  line-height: 1.7;
  white-space: nowrap;
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
.list .small + .small {
  margin-left: 6px;
}
.danger-zone {
  border-color: var(--danger);
}
</style>
