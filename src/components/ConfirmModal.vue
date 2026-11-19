<script setup lang="ts">
/**
 * Модальное подтверждение опасного действия.
 * Одно на все подтверждения: удаление диалога, очистка IndexedDB.
 * Esc — отмена, Enter — подтверждение.
 */
import { onBeforeUnmount, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    message?: string;
    confirmLabel: string;
    cancelLabel: string;
    danger?: boolean;
  }>(),
  { message: "", danger: true },
);

const emit = defineEmits<{ confirm: []; cancel: [] }>();

const cardEl = ref<HTMLElement | null>(null);

function onKeydown(event: KeyboardEvent): void {
  if (!props.open) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    emit("cancel");
    return;
  }
  if (event.key !== "Enter") return;
  // Enter подтверждает, только если фокус не на кнопке снаружи модалки:
  // иначе браузер активирует её и модалка откроется заново.
  const active = document.activeElement as HTMLElement | null;
  const inside = !active || active === document.body || Boolean(cardEl.value?.contains(active));
  if (!inside) return;
  event.preventDefault();
  event.stopPropagation();
  emit("confirm");
}

watch(
  () => props.open,
  (open) => {
    if (open) {
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
  <div v-if="open" class="confirm-modal" role="dialog" aria-modal="true" :aria-label="title">
    <div class="confirm-modal__backdrop" @click="emit('cancel')" />
    <div ref="cardEl" class="confirm-modal__card" :class="{ 'is-danger': danger }">
      <h3 class="confirm-modal__title">{{ title }}</h3>
      <p v-if="message" class="confirm-modal__message">{{ message }}</p>
      <div class="confirm-modal__actions">
        <button type="button" class="confirm-modal__btn" @click="emit('cancel')">
          {{ cancelLabel }}
        </button>
        <button
          type="button"
          class="confirm-modal__btn is-primary"
          :class="{ 'is-danger': danger }"
          @click="emit('confirm')"
        >
          {{ confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.confirm-modal {
  position: fixed;
  inset: 0;
  z-index: 9500;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.confirm-modal__backdrop {
  position: absolute;
  inset: 0;
  background: rgb(0 0 0 / 55%);
  backdrop-filter: blur(2px);
}

.confirm-modal__card {
  position: relative;
  width: min(360px, 100%);
  padding: 18px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--panel);
  box-shadow: 0 18px 48px rgb(0 0 0 / 32%);
}

.confirm-modal__card.is-danger {
  border-color: var(--danger);
}

.confirm-modal__title {
  margin: 0 0 8px;
  font-size: 0.98rem;
  line-height: 1.3;
}

.confirm-modal__message {
  margin: 0;
  color: var(--muted);
  font-size: 0.86rem;
  line-height: 1.4;
}

.confirm-modal__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.confirm-modal__btn {
  padding: 7px 14px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--panel-2);
  color: var(--text);
  font-size: 0.86rem;
  cursor: pointer;
}

.confirm-modal__btn.is-danger {
  border-color: var(--danger);
  background: var(--danger);
  color: #fff;
}
</style>
