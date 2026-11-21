<script setup lang="ts">
/**
 * Текстовая модалка для обрезанных подписей.
 * Названия диалогов в полоске вкладок и в списке не влезают целиком,
 * поэтому долгий тап открывает их без сокращений.
 */
import { onBeforeUnmount, ref, watch } from "vue";

import { isPhantomTap } from "@/lib/press-guard";

const props = defineProps<{
  open: boolean;
  title: string;
  text: string;
  closeLabel: string;
}>();

const emit = defineEmits<{ close: [] }>();

/** Момент открытия: тап, которым закончилось долгое нажатие, не должен закрывать. */
const openedAt = ref(0);

function closeNow(): void {
  if (isPhantomTap(openedAt.value, Date.now())) return;
  emit("close");
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
    if (open) {
      openedAt.value = Date.now();
      window.addEventListener("keydown", onKeydown);
    } else {
      window.removeEventListener("keydown", onKeydown);
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div
    v-if="open"
    class="text-modal"
    role="dialog"
    aria-modal="true"
    :aria-label="title"
    @click.self="closeNow"
  >
    <div class="text-modal__card">
      <h3 class="text-modal__title">{{ title }}</h3>
      <p class="text-modal__text">{{ text }}</p>
      <div class="text-modal__actions">
        <button type="button" class="text-modal__btn" @click="closeNow">
          {{ closeLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.text-modal {
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

.text-modal__card {
  width: min(420px, 100%);
  max-height: 70vh;
  overflow-y: auto;
  padding: 18px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--panel);
  box-shadow: 0 18px 48px rgb(0 0 0 / 32%);
}

.text-modal__title {
  margin: 0 0 8px;
  color: var(--muted);
  font-size: 0.72rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.text-modal__text {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.45;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.text-modal__actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.text-modal__btn {
  padding: 7px 14px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--panel-2);
  color: var(--text);
  font-size: 0.86rem;
  cursor: pointer;
}
</style>
