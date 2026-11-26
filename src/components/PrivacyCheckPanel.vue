<script setup lang="ts">
/**
 * Панель проверки перед отправкой (M3).
 *
 * Показывается над полем ввода, когда в тексте найдены приватные фрагменты
 * и подключение работает в режиме `auto` (открытый текст разрешён, но
 * провайдер доверенный). Чипы — по типам: снятый чип значит «это оставить».
 *
 * После маскирования панель не исчезает сразу, а показывает «Скрыто: N» с
 * кнопкой «Вернуть»: отмена должна быть в один клик, иначе маскировать страшно.
 */

import { computed, ref, watch } from "vue";

import { useLocale } from "@/i18n";
import { summarize, type Finding, type FindingType } from "@/lib/privacy/detect";

const props = defineProps<{
  findings: Finding[];
  /** Сколько фрагментов скрыто последним действием; 0 — панель предлагает скрыть. */
  masked: number;
}>();

const emit = defineEmits<{
  mask: [types: FindingType[]];
  undo: [];
  dismiss: [];
}>();

const { t } = useLocale();

const summary = computed(() => summarize(props.findings));

const typesKey = computed(() => summary.value.map((item) => item.type).join(","));
const selected = ref<Set<FindingType>>(new Set());

watch(
  typesKey,
  () => {
    selected.value = new Set(summary.value.map((item) => item.type));
  },
  { immediate: true },
);

function toggle(type: FindingType): void {
  const next = new Set(selected.value);
  if (next.has(type)) next.delete(type);
  else next.add(type);
  selected.value = next;
}

function label(type: FindingType): string {
  return t(`chat.privacy.type.${type}`);
}

function applyMask(): void {
  const types = [...selected.value];
  if (!types.length) return;
  emit("mask", types);
}

const total = computed(() => props.findings.length);
</script>

<template>
  <div v-if="masked > 0" class="privacy-check privacy-check--done" role="status">
    <svg class="privacy-check__icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
    <span class="privacy-check__text">{{ t("chat.privacy.masked", { n: masked }) }}</span>
    <button type="button" class="privacy-check__link" @click="emit('undo')">
      {{ t("chat.privacy.undo") }}
    </button>
    <button
      type="button"
      class="privacy-check__close"
      :aria-label="t('chat.privacy.later')"
      @click="emit('dismiss')"
    >
      ×
    </button>
  </div>

  <div v-else-if="total" class="privacy-check" role="region" :aria-label="t('chat.privacy.check')">
    <svg class="privacy-check__icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
    <span class="privacy-check__text">{{ t("chat.privacy.found") }}</span>
    <div class="privacy-check__chips">
      <button
        v-for="item in summary"
        :key="item.type"
        type="button"
        class="privacy-check__chip"
        :class="{ 'is-off': !selected.has(item.type) }"
        :aria-pressed="selected.has(item.type)"
        @click="toggle(item.type)"
      >
        {{ label(item.type) }} · {{ item.count }}
      </button>
    </div>
    <button type="button" class="privacy-check__go" @click="applyMask">
      {{ t("chat.privacy.hide") }}
    </button>
    <button
      type="button"
      class="privacy-check__close"
      :aria-label="t('chat.privacy.later')"
      @click="emit('dismiss')"
    >
      ×
    </button>
  </div>
</template>

<style scoped>
.privacy-check {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: 0;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--panel-2);
  color: var(--text);
  font-size: 0.78rem;
  line-height: 1.2;
}

.privacy-check--done {
  color: var(--muted);
}

.privacy-check__icon {
  flex: 0 0 auto;
  color: var(--accent);
}

.privacy-check__text {
  color: var(--muted);
  white-space: nowrap;
}

.privacy-check__chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
}

.privacy-check__chip {
  padding: 2px 8px;
  border: 1px solid var(--accent);
  border-radius: 999px;
  background: transparent;
  color: var(--accent);
  font: inherit;
  cursor: pointer;
}

.privacy-check__chip.is-off {
  border-color: var(--border);
  color: var(--muted);
  text-decoration: line-through;
}

.privacy-check__go {
  margin-left: auto;
  padding: 3px 10px;
  border: 1px solid var(--accent);
  border-radius: 8px;
  background: var(--accent);
  color: var(--panel);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.privacy-check__link {
  padding: 0;
  border: none;
  background: none;
  color: var(--accent);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

.privacy-check__close {
  padding: 0 4px;
  border: none;
  background: none;
  color: var(--muted);
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
}

.privacy-check__chip:focus-visible,
.privacy-check__go:focus-visible,
.privacy-check__link:focus-visible,
.privacy-check__close:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
