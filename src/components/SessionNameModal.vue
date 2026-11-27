<script setup lang="ts">
/**
 * Модалка диалога: название и переименование.
 *
 * Открывается долгим тапом по вкладке — там же название и правится, отдельной
 * кнопки-карандаша в тулбаре больше нет. Enter сохраняет, Esc и тап по фону
 * закрывают. Кнопка «Переименовать» неактивна, если название пустое или не
 * изменилось, — иначе получается лишний запрос к хранилищу.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";

import { isPhantomTap } from "@/lib/press-guard";
import { canRenameSession, normalizeSessionName } from "@/lib/session-name";

const props = defineProps<{
  open: boolean;
  /** Текущее название диалога. */
  name: string;
  title: string;
  placeholder: string;
  renameLabel: string;
  closeLabel: string;
}>();

const emit = defineEmits<{
  rename: [name: string];
  close: [];
}>();

const draft = ref("");
const inputEl = ref<HTMLInputElement | null>(null);
/** Момент открытия: тап, которым закончилось долгое нажатие, не должен закрывать. */
const openedAt = ref(0);

const canSave = computed(() => canRenameSession(draft.value, props.name));

function closeNow(): void {
  if (isPhantomTap(openedAt.value, Date.now())) return;
  emit("close");
}

function submit(): void {
  if (!canSave.value) return;
  emit("rename", normalizeSessionName(draft.value));
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  emit("close");
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      window.removeEventListener("keydown", onKeydown);
      return;
    }
    openedAt.value = Date.now();
    draft.value = props.name;
    window.addEventListener("keydown", onKeydown);
    // Фокус и выделение: с телефона сразу печатаешь, а не тапаешь ещё раз по полю.
    void nextTick(() => {
      inputEl.value?.focus();
      inputEl.value?.select();
    });
  },
  { immediate: true },
);

onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div
    v-if="open"
    class="name-modal"
    role="dialog"
    aria-modal="true"
    :aria-label="title"
    @click.self="closeNow"
  >
    <div class="name-modal__card">
      <h3 class="name-modal__title">{{ title }}</h3>
      <input
        ref="inputEl"
        v-model="draft"
        class="name-modal__input"
        type="text"
        :placeholder="placeholder"
        :aria-label="placeholder"
        @keydown.enter.prevent="submit"
      />
      <div class="name-modal__actions">
        <button
          type="button"
          class="name-modal__btn name-modal__btn--primary"
          :disabled="!canSave"
          @click="submit"
        >
          {{ renameLabel }}
        </button>
        <button type="button" class="name-modal__btn" @click="closeNow">
          {{ closeLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.name-modal {
  position: fixed;
  inset: 0;
  z-index: 9500;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgb(0 0 0 / 55%);
  backdrop-filter: blur(2px);
}

.name-modal__card {
  width: min(420px, 100%);
  padding: 18px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--panel);
  box-shadow: 0 18px 48px rgb(0 0 0 / 32%);
}

.name-modal__title {
  margin: 0 0 10px;
  color: var(--muted);
  font-size: 0.72rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.name-modal__input {
  width: 100%;
  padding: 9px 11px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--panel-2);
  color: var(--text);
  font-size: 0.95rem;
  font-family: inherit;
}

.name-modal__input:focus {
  border-color: var(--accent);
  outline: none;
}

.name-modal__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.name-modal__btn {
  padding: 7px 14px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--panel-2);
  color: var(--text);
  font-size: 0.86rem;
  cursor: pointer;
}

.name-modal__btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.name-modal__btn--primary {
  border-color: transparent;
  background: var(--accent);
  color: #fff;
}
</style>
