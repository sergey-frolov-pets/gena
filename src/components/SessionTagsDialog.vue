<script setup lang="ts">
/**
 * Редактор тегов диалога: поле «через запятую» + подсказки из уже существующих
 * тегов. Один компонент на лист истории и страницу сессий — чтобы правила
 * ввода и вид были одинаковыми.
 */
import { ref, watch } from "vue";
import { formatTagsInput, parseTagsInput, MAX_TAGS } from "@/lib/session-tags";
import { useLocale } from "@/i18n";

const props = defineProps<{
  open: boolean;
  /** Название диалога — в заголовке, чтобы не перепутать. */
  sessionTitle: string;
  /** Текущие теги диалога. */
  tags: string[];
  /** Все теги приложения: нажатие добавляет тег. */
  suggestions: string[];
}>();

const emit = defineEmits<{ close: []; save: [tags: string[]] }>();

const { t } = useLocale();
const draft = ref("");

watch(
  () => props.open,
  (open) => {
    if (open) draft.value = formatTagsInput(props.tags);
  },
  { immediate: true },
);

/** Подсказки, которых ещё нет в черновике. */
function freeSuggestions(): string[] {
  const present = new Set(parseTagsInput(draft.value).map((tag) => tag.toLowerCase()));
  return props.suggestions.filter((tag) => !present.has(tag.toLowerCase()));
}

function addSuggestion(tag: string): void {
  const current = parseTagsInput(draft.value);
  if (current.length >= MAX_TAGS) return;
  draft.value = [...current, tag].join(", ");
}

function save(): void {
  emit("save", parseTagsInput(draft.value));
}
</script>

<template>
  <div v-if="open" class="tags-modal" role="dialog" aria-modal="true" :aria-label="t('chat.tagsEditTitle')">
    <div class="tags-modal__backdrop" @click="emit('close')" />
    <div class="tags-modal__card">
      <h3 class="tags-modal__title">{{ t("chat.tagsEditTitle") }}</h3>
      <p class="tags-modal__subject">{{ sessionTitle }}</p>
      <input
        v-model="draft"
        class="tags-modal__input"
        type="text"
        :placeholder="t('chat.tagsPlaceholder')"
        :aria-label="t('chat.tags')"
        @keydown.enter.prevent="save"
        @keydown.esc.prevent="emit('close')"
      />
      <div v-if="freeSuggestions().length > 0" class="tags-modal__suggestions">
        <button
          v-for="tag in freeSuggestions()"
          :key="tag"
          type="button"
          class="tags-modal__chip"
          @click="addSuggestion(tag)"
        >
          {{ tag }}
        </button>
      </div>
      <div class="tags-modal__actions">
        <button type="button" class="tags-modal__btn" @click="emit('close')">
          {{ t("chat.cancel") }}
        </button>
        <button type="button" class="tags-modal__btn is-primary" @click="save">
          {{ t("chat.tagsSave") }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tags-modal {
  position: fixed;
  inset: 0;
  z-index: 9500;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.tags-modal__backdrop {
  position: absolute;
  inset: 0;
  background: rgb(0 0 0 / 55%);
  backdrop-filter: blur(2px);
}

.tags-modal__card {
  position: relative;
  width: min(380px, 100%);
  padding: 18px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--panel);
  box-shadow: 0 18px 48px rgb(0 0 0 / 32%);
}

.tags-modal__title {
  margin: 0 0 4px;
  font-size: 0.98rem;
  line-height: 1.3;
}

.tags-modal__subject {
  margin: 0 0 12px;
  color: var(--muted);
  font-size: 0.82rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tags-modal__input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--panel-2);
  color: var(--text);
  font: inherit;
  font-size: 0.88rem;
}

.tags-modal__suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.tags-modal__chip {
  padding: 3px 9px;
  border: 1px dashed var(--border);
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 0.76rem;
  cursor: pointer;
}

.tags-modal__chip:hover {
  border-color: var(--accent);
  color: var(--text);
}

.tags-modal__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.tags-modal__btn {
  padding: 7px 14px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--panel-2);
  color: var(--text);
  font-size: 0.86rem;
  cursor: pointer;
}

.tags-modal__btn.is-primary {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
}
</style>
