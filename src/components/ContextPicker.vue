<script setup lang="ts">
/**
 * Модалка «@»: поиск диалогов и проектов для контекста.
 *
 * Показывает локальные диалоги, серверные (которых нет на устройстве) и
 * проекты. У каждой строки две кнопки: «Целиком» и «Саммари» — обе
 * добавляют чип, повторный клик убирает. Проект можно создать из уже
 * выбранных диалогов.
 */

import { computed, ref, watch } from "vue";
import { useLocale } from "@/i18n";
import { chipKey, makeChip, type ContextChip } from "@/lib/context-bridge";
import type { Project, Session } from "@/storage/types";

const props = defineProps<{
  open: boolean;
  sessions: Session[];
  projects: Project[];
  /** Диалоги с сервера, которых нет на устройстве. */
  remoteSessions: { id: string; remoteId: string; serverId: string; title: string; messageCount?: number; updatedAt: number }[];
  chips: ContextChip[];
}>();

const emit = defineEmits<{
  close: [];
  toggle: [chip: ContextChip];
  createProject: [name: string, sessionIds: string[]];
  deleteProject: [id: string];
}>();

const { t } = useLocale();
const query = ref("");
const newProject = ref("");
const showNewProject = ref(false);

watch(
  () => props.open,
  (open) => {
    if (!open) {
      query.value = "";
      showNewProject.value = false;
      newProject.value = "";
    }
  },
);

const needle = computed(() => query.value.trim().toLowerCase());

function matches(title: string): boolean {
  if (!needle.value) return true;
  return title.toLowerCase().includes(needle.value);
}

const visibleSessions = computed(() => props.sessions.filter((item) => matches(item.title)));
const visibleRemote = computed(() => props.remoteSessions.filter((item) => matches(item.title)));
const visibleProjects = computed(() => props.projects.filter((item) => matches(item.name)));

/** Выбранные диалоги — из них создаётся новый проект. */
const pickedSessionIds = computed(() =>
  props.chips.filter((chip) => chip.kind === "session" && chip.mode === "full").map((chip) => chip.id),
);

const selected = computed(() => new Set(props.chips.map((chip) => chip.key)));

function isOn(kind: "session" | "project", id: string, mode: "full" | "summary"): boolean {
  return selected.value.has(chipKey(kind, id, mode));
}

function toggleSession(session: Session, mode: "full" | "summary"): void {
  emit(
    "toggle",
    makeChip({
      kind: "session",
      mode,
      id: session.id,
      title: session.title,
      summary: session.summary,
      serverId: session.serverId,
      serverRef: undefined,
      remoteId: session.serverId,
      messageCount: session.messageCount,
    } as Omit<ContextChip, "key">),
  );
}

function toggleRemote(item: { id: string; remoteId: string; serverId: string; title: string; messageCount?: number }, mode: "full" | "summary"): void {
  emit(
    "toggle",
    makeChip({
      kind: "session",
      mode,
      id: item.id,
      title: item.title,
      remoteId: item.remoteId,
      serverId: item.serverId,
      messageCount: item.messageCount,
    }),
  );
}

function toggleProject(project: Project, mode: "full" | "summary"): void {
  emit(
    "toggle",
    makeChip({
      kind: "project",
      mode,
      id: project.id,
      title: project.name,
      summary: project.summary,
      messageCount: project.messageCount,
    }),
  );
}

function submitProject(): void {
  const name = newProject.value.trim();
  if (!name) return;
  emit("createProject", name, pickedSessionIds.value);
  newProject.value = "";
  showNewProject.value = false;
}

function closeOnEscape(event: KeyboardEvent): void {
  if (event.key === "Escape") emit("close");
}
</script>

<template>
  <div v-if="open" class="ctx-overlay" @keydown="closeOnEscape">
    <div class="ctx-panel" role="dialog" :aria-label="t('chat.ctx.title')">
      <header class="ctx-head">
        <span class="ctx-title">{{ t("chat.ctx.title") }}</span>
        <input
          v-model="query"
          class="ctx-search"
          type="search"
          :placeholder="t('chat.ctx.search')"
          :aria-label="t('chat.ctx.search')"
          autofocus
        />
        <button type="button" class="ctx-close" :aria-label="t('chat.ctx.close')" @click="emit('close')">
          ×
        </button>
      </header>

      <div class="ctx-body">
        <section class="ctx-section">
          <h3 class="ctx-section__title">{{ t("chat.ctx.projects") }}</h3>
          <p v-if="visibleProjects.length === 0" class="ctx-empty">{{ t("chat.ctx.noProjects") }}</p>
          <div v-for="project in visibleProjects" :key="project.id" class="ctx-row">
            <div class="ctx-row__main">
              <span class="ctx-row__title">{{ project.name }}</span>
              <span class="ctx-row__meta">
                {{ t("chat.ctx.messages", { count: project.sessionIds.length }) }}
                <template v-if="project.summary?.stale"> · {{ t("chat.ctx.stale") }}</template>
              </span>
            </div>
            <div class="ctx-row__actions">
              <button
                type="button"
                class="ctx-pill"
                :class="{ 'is-on': isOn('project', project.id, 'full') }"
                @click="toggleProject(project, 'full')"
              >
                {{ t("chat.ctx.full") }}
              </button>
              <button
                type="button"
                class="ctx-pill"
                :class="{ 'is-on': isOn('project', project.id, 'summary') }"
                @click="toggleProject(project, 'summary')"
              >
                {{ t("chat.ctx.summary") }}
              </button>
              <button
                type="button"
                class="ctx-drop"
                :aria-label="t('chat.ctx.deleteProject')"
                v-tip="t('chat.ctx.deleteProject')"
                @click="emit('deleteProject', project.id)"
              >
                ×
              </button>
            </div>
          </div>
          <div class="ctx-new">
            <button
              v-if="!showNewProject"
              type="button"
              class="ctx-new__toggle"
              @click="showNewProject = true"
            >
              + {{ t("chat.ctx.newProject") }}
            </button>
            <template v-else>
              <input
                v-model="newProject"
                class="ctx-new__input"
                :placeholder="t('chat.ctx.projectName')"
                :aria-label="t('chat.ctx.projectName')"
                @keydown.enter.prevent="submitProject"
              />
              <button type="button" class="ctx-pill is-on" @click="submitProject">
                {{ t("chat.ctx.create") }}
              </button>
              <button type="button" class="ctx-pill" @click="showNewProject = false">
                {{ t("chat.ctx.cancel") }}
              </button>
            </template>
            <span v-if="showNewProject && pickedSessionIds.length > 0" class="ctx-hint">
              {{ t("chat.ctx.fromSelected", { count: pickedSessionIds.length }) }}
            </span>
          </div>
        </section>

        <section class="ctx-section">
          <h3 class="ctx-section__title">{{ t("chat.ctx.sessions") }}</h3>
          <p v-if="visibleSessions.length === 0 && visibleRemote.length === 0" class="ctx-empty">
            {{ t("chat.ctx.empty") }}
          </p>
          <div v-for="session in visibleSessions" :key="session.id" class="ctx-row">
            <div class="ctx-row__main">
              <span class="ctx-row__title">{{ session.title || t("chat.ctx.untitled") }}</span>
              <span class="ctx-row__meta">
                {{ t("chat.ctx.messages", { count: session.messageCount ?? 0 }) }}
                <template v-if="session.summary?.stale"> · {{ t("chat.ctx.stale") }}</template>
              </span>
            </div>
            <div class="ctx-row__actions">
              <button
                type="button"
                class="ctx-pill"
                :class="{ 'is-on': isOn('session', session.id, 'full') }"
                @click="toggleSession(session, 'full')"
              >
                {{ t("chat.ctx.full") }}
              </button>
              <button
                type="button"
                class="ctx-pill"
                :class="{ 'is-on': isOn('session', session.id, 'summary') }"
                @click="toggleSession(session, 'summary')"
              >
                {{ t("chat.ctx.summary") }}
              </button>
            </div>
          </div>
          <div
            v-for="item in visibleRemote"
            :key="item.id"
            class="ctx-row is-remote"
          >
            <div class="ctx-row__main">
              <span class="ctx-row__title">{{ item.title || t("chat.ctx.untitled") }}</span>
              <span class="ctx-row__meta">
                {{ t("chat.ctx.messages", { count: item.messageCount ?? 0 }) }} · {{ t("chat.ctx.onServer") }}
              </span>
            </div>
            <div class="ctx-row__actions">
              <button
                type="button"
                class="ctx-pill"
                :class="{ 'is-on': isOn('session', item.id, 'full') }"
                @click="toggleRemote(item, 'full')"
              >
                {{ t("chat.ctx.full") }}
              </button>
              <button
                type="button"
                class="ctx-pill"
                :class="{ 'is-on': isOn('session', item.id, 'summary') }"
                @click="toggleRemote(item, 'summary')"
              >
                {{ t("chat.ctx.summary") }}
              </button>
            </div>
          </div>
        </section>
      </div>

      <footer class="ctx-foot">
        <span class="ctx-count">{{ t("chat.ctx.picked", { count: chips.length }) }}</span>
        <button type="button" class="ctx-done" @click="emit('close')">{{ t("chat.ctx.done") }}</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.ctx-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.45);
}

.ctx-panel {
  display: flex;
  flex-direction: column;
  width: min(640px, 100%);
  max-height: min(80vh, 640px);
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--panel);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.32);
}

.ctx-head {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
}

.ctx-title {
  font-weight: 600;
  white-space: nowrap;
}

.ctx-search {
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-2);
  color: var(--text);
}

.ctx-close {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--muted);
  font-size: 18px;
}

.ctx-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 14px 14px;
}

.ctx-section + .ctx-section {
  margin-top: 14px;
}

.ctx-section__title {
  margin: 8px 0 6px;
  color: var(--muted);
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.ctx-row {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  padding: 6px 4px;
  border-radius: 8px;
}

.ctx-row:hover {
  background: var(--panel-2);
}

.ctx-row__main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.ctx-row__title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ctx-row__meta {
  color: var(--muted);
  font-size: 0.74rem;
}

.ctx-row__actions {
  display: flex;
  gap: 4px;
  align-items: center;
}

.ctx-pill {
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: transparent;
  color: var(--text);
  font-size: 0.76rem;
  white-space: nowrap;
}

.ctx-pill.is-on {
  border-color: transparent;
  background: var(--accent, #3b82f6);
  color: #fff;
}

.ctx-drop {
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--muted);
}

.ctx-empty {
  margin: 4px 0;
  color: var(--muted);
  font-size: 0.8rem;
}

.ctx-new {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin-top: 8px;
}

.ctx-new__toggle {
  padding: 4px 10px;
  border: 1px dashed var(--border);
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  font-size: 0.78rem;
}

.ctx-new__input {
  min-width: 180px;
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-2);
  color: var(--text);
}

.ctx-hint {
  color: var(--muted);
  font-size: 0.74rem;
}

.ctx-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-top: 1px solid var(--border);
}

.ctx-count {
  color: var(--muted);
  font-size: 0.78rem;
}

.ctx-done {
  padding: 6px 14px;
  border: 0;
  border-radius: 8px;
  background: var(--accent, #3b82f6);
  color: #fff;
  font-weight: 600;
}
</style>
