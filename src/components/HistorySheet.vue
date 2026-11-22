<script setup lang="ts">
/**
 * Лист истории диалогов: поиск, фильтр по агенту, пин, дублирование, удаление.
 *
 * Компонент только рисует и фильтрует. Список `sessions` — все диалоги без
 * деления по агенту (решение Сергея, 22.11.2026): нужный агент выбирается
 * чипами. Открытие, пин, копия и удаление — события наружу, там стор.
 *
 * Монтируется постоянно, панель скрывается по `open`: иначе поиск и фильтр
 * сбрасывались бы при каждом закрытии.
 */

import { computed, ref } from "vue";
import { useAgentFilter } from "@/composables/useAgentFilter";
import { visibleSessions } from "@/lib/session-list";
import { useLocale } from "@/i18n";
import type { Session } from "@/storage/types";

const props = defineProps<{
  /** Панель открыта. */
  open: boolean;
  /** Все диалоги. */
  sessions: Session[];
  /** Все агенты — для подписей строк и чипов фильтра. */
  agents: { id: string; name: string }[];
  /** Открытый диалог. */
  activeId: string | null;
  /** Диалоги, где агент отвечает или ждёт очереди. */
  busyIds: Set<string>;
}>();

const emit = defineEmits<{
  close: [];
  /** Открыть диалог. */
  pick: [id: string];
  pin: [session: Session];
  duplicate: [session: Session];
  /** Запрошено удаление — подтверждение спрашивает вызывающий. */
  delete: [id: string];
  title: [title: string];
}>();

const { t } = useLocale();

/** Поиск по названию — живёт здесь, чтобы не сбрасываться при закрытии. */
const query = ref("");

const {
  filter: agentFilter,
  agentsInUse,
  filtered: sessionsOfAgent,
} = useAgentFilter(
  computed(() => props.sessions),
  computed(() => props.agents),
);

/** Фильтр по агенту + поиск, закреплённые сверху, дальше — свежие первыми. */
const filteredSessions = computed<Session[]>(() =>
  visibleSessions(sessionsOfAgent.value, query.value),
);


/** Имя агента для строки истории (у каждой сессии своё). */
function agentNameOf(id: string): string {
  return props.agents.find((agent) => agent.id === id)?.name?.trim() || t("chat.agent");
}
</script>

<template>
  <div v-if="open" class="chat-panel__sheet-backdrop" @click="emit('close')" />
  <aside
    v-if="open"
    class="chat-panel__sheet"
    role="dialog"
    aria-modal="true"
    :aria-label="t('chat.dialogs')"
  >
    <div class="chat-panel__sheet-head">
      <input
        v-model="query"
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
        @click="emit('close')"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
    <div class="chat-panel__filter-chips" role="group" :aria-label="t('chat.filterAgent')">
      <button
        type="button"
        class="chat-panel__filter-chip"
        :class="{ 'is-on': !agentFilter }"
        :aria-pressed="!agentFilter"
        @click="agentFilter = ''"
      >
        {{ t("chat.allAgents") }}
      </button>
      <button
        v-for="agent in agentsInUse"
        :key="agent.id"
        type="button"
        class="chat-panel__filter-chip"
        :class="{ 'is-on': agentFilter === agent.id }"
        :aria-pressed="agentFilter === agent.id"
        @click="agentFilter = agent.id"
      >
        {{ agent.name }}
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
        :class="{
          'is-active': s.id === activeId,
          'is-pinned': s.pinned,
          'is-busy': busyIds.has(s.id),
        }"
      >
        <button
          class="chat-panel__session-open"
          type="button"
          v-longpress="() => emit('title', s.title)"
          @click="emit('pick', s.id)"
        >
          <span class="chat-panel__session-main">
            <span class="chat-panel__session-title">
              <span
                v-if="busyIds.has(s.id)"
                class="chat-panel__busy-dot"
                aria-hidden="true"
              />{{ s.title }}
            </span>
            <span v-if="!agentFilter" class="chat-panel__session-agent">
              {{ agentNameOf(s.agentId) }}
            </span>
          </span>
          <span class="chat-panel__session-count">{{ s.messageCount }}</span>
        </button>

        <div class="chat-panel__session-actions">
          <button
            type="button"
            class="chat-panel__action"
            :class="{ 'is-on': s.pinned }"
            v-tip="s.pinned ? t('chat.unpin') : t('chat.pin')"
            :aria-label="s.pinned ? t('chat.unpin') : t('chat.pin')"
            @click="emit('pin', s)"
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
            @click="emit('duplicate', s)"
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
            @click="emit('delete', s.id)"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
            </svg>
          </button>
        </div>
      </li>
    </ul>
  </aside>
</template>

<style scoped>
/* --- Лист истории: выезжает справа поверх ленты -------------------------- */
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

/* Фильтр истории по агенту: чипы «Все агенты» + те, у кого есть диалоги. */
.chat-panel__filter-chips {
  display: flex;
  gap: 6px;
  margin: 6px 0 4px;
  overflow-x: auto;
  scrollbar-width: none;
}

.chat-panel__filter-chips::-webkit-scrollbar {
  display: none;
}

.chat-panel__filter-chip {
  flex: 0 0 auto;
  max-width: 11rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--panel);
  color: var(--muted);
  font: inherit;
  font-size: 0.76rem;
  cursor: pointer;
}

.chat-panel__filter-chip.is-on {
  border-color: var(--accent);
  background: var(--panel-2);
  color: var(--text);
  font-weight: 600;
}

/* Агент отвечает (или реплика ждёт очереди) — диалог в списке выделяем жирным. */
.chat-panel__session.is-busy .chat-panel__session-title {
  font-weight: 650;
  color: var(--text);
}

.chat-panel__session-title .chat-panel__busy-dot {
  display: inline-block;
  margin-inline-end: 6px;
  vertical-align: middle;
}

.chat-panel__session-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  text-align: start;
}

.chat-panel__session-agent {
  color: var(--muted);
  font-size: 0.7rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
</style>
