<script setup lang="ts">
/**
 * Очередь реплик открытого диалога: что уйдёт агенту после текущего хода.
 *
 * Компонент только рисует список. Отправка «сейчас», правка и удаление —
 * события наружу: очередь живёт в IndexedDB и в планировщике ходов.
 * Кнопки используют общие атомы `.chat-panel__action` из глобальных стилей.
 */

import { useLocale } from "@/i18n";

defineProps<{
  /** Реплики очереди по порядку. */
  items: { id: string; text: string }[];
}>();

const emit = defineEmits<{
  sendNow: [id: string];
  edit: [id: string];
  remove: [id: string];
}>();

const { t } = useLocale();
</script>

<template>
  <div v-if="items.length > 0" class="session-queue">
    <p class="session-queue__title">
      {{ t("chat.queue.title", { count: items.length }) }}
    </p>
    <ul class="session-queue__list">
      <li v-for="q in items" :key="q.id" class="session-queue__item">
        <span class="session-queue__text">
          {{ q.text || t("chat.queue.attachment") }}
        </span>
        <span class="session-queue__actions">
          <button
            type="button"
            class="chat-panel__action"
            v-tip="t('chat.queue.sendNow')"
            :aria-label="t('chat.queue.sendNow')"
            @click="emit('sendNow', q.id)"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 19V5" />
              <path d="m6 11 6-6 6 6" />
            </svg>
          </button>
          <button
            type="button"
            class="chat-panel__action"
            v-tip="t('chat.queue.edit')"
            :aria-label="t('chat.queue.edit')"
            @click="emit('edit', q.id)"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M4 20h4l10-10a2.8 2.8 0 1 0-4-4L4 16z" />
            </svg>
          </button>
          <button
            type="button"
            class="chat-panel__action is-danger"
            v-tip="t('chat.queue.remove')"
            :aria-label="t('chat.queue.remove')"
            @click="emit('remove', q.id)"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.session-queue {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border: 1px dashed var(--border);
  border-radius: 12px;
  background: color-mix(in srgb, var(--panel-2) 70%, transparent);
}

.session-queue__title {
  margin: 0;
  color: var(--muted);
  font-size: 0.7rem;
}

.session-queue__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.session-queue__item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.session-queue__text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.78rem;
  color: var(--text);
}

.session-queue__actions {
  display: flex;
  flex: 0 0 auto;
  gap: 2px;
}
</style>
