<script setup lang="ts">
/**
 * Чипы контекста в композере: какие диалоги и проекты приложены к реплике.
 *
 * Компонент только рисует: источник, режим (целиком или саммари), состояние
 * «считаю саммари» и кнопку удаления. Хранение и сборка текста — в ChatView.
 */

import { useLocale } from "@/i18n";
import { chipLabel, type ContextChip } from "@/lib/context-bridge";

defineProps<{
  chips: ContextChip[];
  /** Состояние чипа: пока идёт расчёт саммари или случилась ошибка. */
  states: Record<string, "summarizing" | "error" | undefined>;
}>();

const emit = defineEmits<{
  remove: [key: string];
}>();

const { t } = useLocale();
</script>

<template>
  <div v-if="chips.length > 0" class="context-tray" role="list">
    <div
      v-for="chip in chips"
      :key="chip.key"
      class="context-tray__chip"
      :class="[`is-${chip.kind}`, { 'is-error': states[chip.key] === 'error' }]"
      role="listitem"
      :title="chipLabel(chip)"
    >
      <span class="context-tray__mark" aria-hidden="true">@</span>
      <span class="context-tray__name">{{ chip.title || t("chat.ctx.untitled") }}</span>
      <span class="context-tray__mode">
        {{ states[chip.key] === "summarizing"
          ? t("chat.ctx.summarizing")
          : chip.mode === "summary"
            ? t("chat.ctx.summary")
            : t("chat.ctx.full") }}
      </span>
      <button
        type="button"
        class="context-tray__remove"
        v-tip="t('chat.ctx.remove')"
        :aria-label="t('chat.ctx.remove')"
        @click="emit('remove', chip.key)"
      >
        ×
      </button>
    </div>
  </div>
</template>

<style scoped>
.context-tray {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.context-tray__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 260px;
  height: 28px;
  padding: 0 6px 0 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-2);
  color: var(--text);
  font-size: 0.78rem;
}

.context-tray__chip.is-project {
  border-color: var(--accent, var(--border));
}

.context-tray__chip.is-error {
  border-color: var(--danger, #d9534f);
}

.context-tray__mark {
  color: var(--muted);
  font-weight: 700;
}

.context-tray__name {
  overflow: hidden;
  max-width: 150px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.context-tray__mode {
  padding: 1px 5px;
  border-radius: 5px;
  background: rgba(127, 127, 127, 0.16);
  color: var(--muted);
  font-size: 0.7rem;
  white-space: nowrap;
}

.context-tray__remove {
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--muted);
  font-size: 14px;
  line-height: 1;
}

.context-tray__remove:hover {
  color: var(--text);
  background: rgba(127, 127, 127, 0.18);
}
</style>
