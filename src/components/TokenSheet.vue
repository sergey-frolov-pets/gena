<script setup lang="ts">
/**
 * Выезжающая таблица соответствий «токен ↔ значение» прямо в чате.
 *
 * Главное — обратимая подмена: в ленте человек видит значения (или токены,
 * если переключил), агенту всегда уходят токены. Правки строки делаются здесь
 * же и сразу попадают в справочник. Отдельная вкладка «Справочник» остаётся
 * для переноса файла и морфологического словаря — это дополнительная функция.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useLocale } from "@/i18n";
import { formatToken } from "@/lib/tokens/format";
import {
  loadTokens,
  removeToken,
  saveToken,
  tokenEntries,
  TokenError,
  tokensBroken,
  type TokenEntry,
} from "@/lib/tokens/registry";
import ConfirmModal from "@/components/ConfirmModal.vue";

defineProps<{ showValues: boolean }>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "toggle-values"): void;
  (e: "insert", name: string): void;
  (e: "open-tokens"): void;
}>();

const { t } = useLocale();

const editingId = ref<string | null>(null);
const creating = ref(false);
const form = reactive({ name: "", value: "", variants: "", note: "", caseSensitive: false });
const error = ref("");
const notice = ref("");
const revealed = ref<Set<string>>(new Set());
const pendingRemove = ref<TokenEntry | null>(null);

const editing = computed(() => creating.value || editingId.value !== null);

/** Строки по алфавиту: длинный список иначе не найти глазами. */
const rows = computed(() =>
  [...tokenEntries.value].sort((a, b) => {
    const left = a.name.toLowerCase();
    const right = b.name.toLowerCase();
    if (left === right) return 0;
    return left < right ? -1 : 1;
  }),
);

const ERROR_KEYS: Record<string, string> = {
  name_required: "tokens.error.name_required",
  name_invalid: "tokens.error.name_invalid",
  name_duplicate: "tokens.error.name_duplicate",
  value_required: "tokens.error.value_required",
  save_failed: "tokens.error.save_failed",
  insecure_context: "tokens.error.insecure_context",
};

function describeTokenError(code: string): string {
  const key = ERROR_KEYS[code];
  return key ? t(key as Parameters<typeof t>[0]) : t("tokens.error.save_failed");
}

function startEdit(entry?: TokenEntry): void {
  error.value = "";
  notice.value = "";
  if (entry) {
    editingId.value = entry.id;
    creating.value = false;
    form.name = entry.name;
    form.value = entry.value;
    form.variants = (entry.variants ?? []).join("\n");
    form.note = entry.note ?? "";
    form.caseSensitive = entry.caseSensitive === true;
  } else {
    editingId.value = null;
    creating.value = true;
    form.name = "";
    form.value = "";
    form.variants = "";
    form.note = "";
    form.caseSensitive = false;
  }
}

function cancelEdit(): void {
  editingId.value = null;
  creating.value = false;
  form.name = "";
  form.value = "";
  form.variants = "";
  form.note = "";
  form.caseSensitive = false;
  error.value = "";
}

async function save(): Promise<void> {
  error.value = "";
  try {
    const input = {
      name: form.name,
      value: form.value,
      variants: form.variants
        .split("\n")
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
      note: form.note,
      caseSensitive: form.caseSensitive,
      ...(editingId.value ? { id: editingId.value } : {}),
    };
    await saveToken(input);
    notice.value = t("tokens.saved");
    cancelEdit();
  } catch (e) {
    error.value = e instanceof TokenError ? describeTokenError(e.code) : t("tokens.error.save_failed");
  }
}

function isRevealed(id: string): boolean {
  return revealed.value.has(id);
}

function toggleReveal(id: string): void {
  const next = new Set(revealed.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  revealed.value = next;
}

function askRemove(entry: TokenEntry): void {
  notice.value = "";
  pendingRemove.value = entry;
}

async function confirmRemove(): Promise<void> {
  const entry = pendingRemove.value;
  pendingRemove.value = null;
  if (!entry) return;
  try {
    await removeToken(entry.id);
    if (editingId.value === entry.id) cancelEdit();
    toggleRevealOff(entry.id);
    notice.value = t("tokens.deleted");
  } catch {
    error.value = t("tokens.error.save_failed");
  }
}

function toggleRevealOff(id: string): void {
  if (!revealed.value.has(id)) return;
  const next = new Set(revealed.value);
  next.delete(id);
  revealed.value = next;
}

/** Скопировать канон токена, чтобы вставить его в чужое поле. */
async function copyToken(name: string): Promise<void> {
  const text = formatToken(name);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "true");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  notice.value = t("tokens.sheet.copied");
}

function insertToken(name: string): void {
  emit("insert", name);
  emit("close");
}

function openDictionary(): void {
  emit("open-tokens");
  emit("close");
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && !pendingRemove.value) {
    event.preventDefault();
    emit("close");
  }
}

onMounted(() => {
  document.addEventListener("keydown", onKeydown);
  void loadTokens().catch(() => undefined);
});

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div class="token-sheet__wrap">
    <div class="token-sheet__backdrop" @click="emit('close')" />
    <aside class="token-sheet" role="dialog" aria-modal="true" :aria-label="t('tokens.sheet.title')">
      <header class="token-sheet__head">
        <h2 class="token-sheet__title">{{ t("tokens.sheet.title") }}</h2>
        <button
          type="button"
          class="token-sheet__icon"
          :aria-label="t('chat.close')"
          :title="t('chat.close')"
          @click="emit('close')"
        >
          ×
        </button>
      </header>

      <p class="token-sheet__hint">{{ t("tokens.sheet.hint") }}</p>

      <div class="token-sheet__switch">
        <button
          type="button"
          class="token-sheet__toggle"
          :aria-pressed="!showValues"
          @click="emit('toggle-values')"
        >
          {{ showValues ? t("chat.viewTokens") : t("chat.viewData") }}
        </button>
        <span class="token-sheet__count">{{ t("tokens.sheet.rows", { count: rows.length }) }}</span>
      </div>

      <p v-if="tokensBroken > 0" class="token-sheet__warn">
        {{ t("tokens.error.broken", { count: tokensBroken }) }}
      </p>

      <form v-if="editing" class="token-sheet__form" @submit.prevent="save">
        <label class="token-sheet__field">
          <span>{{ t("tokens.name") }}</span>
          <input v-model="form.name" type="text" :placeholder="t('tokens.namePlaceholder')" />
        </label>
        <label class="token-sheet__field">
          <span>{{ t("tokens.value") }}</span>
          <textarea v-model="form.value" rows="2" :placeholder="t('tokens.valuePlaceholder')" />
        </label>
        <label class="token-sheet__field">
          <span>{{ t("tokens.variants") }}</span>
          <textarea v-model="form.variants" rows="2" :placeholder="t('tokens.variantsHint')" />
        </label>
        <label class="token-sheet__field">
          <span>{{ t("tokens.note") }}</span>
          <input v-model="form.note" type="text" :placeholder="t('tokens.notePlaceholder')" />
        </label>
        <label class="token-sheet__check">
          <input v-model="form.caseSensitive" type="checkbox" />
          <span>{{ t("tokens.caseSensitive") }}</span>
        </label>
        <p v-if="error" class="token-sheet__error" role="alert">{{ error }}</p>
        <div class="token-sheet__form-actions">
          <button type="submit" class="token-sheet__button is-primary">{{ t("tokens.save") }}</button>
          <button type="button" class="token-sheet__button" @click="cancelEdit">
            {{ t("tokens.cancel") }}
          </button>
        </div>
      </form>

      <p v-else-if="rows.length === 0" class="token-sheet__empty">{{ t("tokens.sheet.empty") }}</p>

      <table v-else class="token-sheet__table">
        <thead>
          <tr>
            <th scope="col">{{ t("tokens.sheet.token") }}</th>
            <th scope="col">{{ t("tokens.value") }}</th>
            <th scope="col"><span class="token-sheet__visually-hidden">{{ t("tokens.sheet.actions") }}</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in rows" :key="entry.id">
            <td class="token-sheet__token-cell">
              <button
                type="button"
                class="token-sheet__token"
                :title="t('tokens.sheet.copy')"
                @click="copyToken(entry.name)"
              >
                ⟦{{ entry.name }}⟧
              </button>
            </td>
            <td class="token-sheet__value-cell">
              <button
                type="button"
                class="token-sheet__value"
                :title="isRevealed(entry.id) ? t('tokens.hide') : t('tokens.reveal')"
                @click="toggleReveal(entry.id)"
              >
                {{ isRevealed(entry.id) ? entry.value : "••••••" }}
              </button>
            </td>
            <td class="token-sheet__row-actions">
              <button
                type="button"
                class="token-sheet__icon"
                :title="t('tokens.edit')"
                :aria-label="t('tokens.edit')"
                @click="startEdit(entry)"
              >
                ✎
              </button>
              <button
                type="button"
                class="token-sheet__icon"
                :title="t('tokens.delete')"
                :aria-label="t('tokens.delete')"
                @click="askRemove(entry)"
              >
                ×
              </button>
              <button
                type="button"
                class="token-sheet__icon is-insert"
                :title="t('tokens.sheet.insert')"
                :aria-label="t('tokens.sheet.insert')"
                @click="insertToken(entry.name)"
              >
                ↵
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <p v-if="notice" class="token-sheet__notice" role="status">{{ notice }}</p>

      <div class="token-sheet__foot">
        <button type="button" class="token-sheet__button" @click="startEdit()">
          + {{ t("tokens.sheet.add") }}
        </button>
        <button type="button" class="token-sheet__link" @click="openDictionary">
          {{ t("tokens.sheet.more") }}
        </button>
      </div>
    </aside>

    <ConfirmModal
      :open="pendingRemove !== null"
      :title="t('tokens.sheet.removeTitle')"
      :message="t('tokens.sheet.removeQuestion', { name: pendingRemove?.name ?? '' })"
      :confirm-label="t('tokens.delete')"
      :cancel-label="t('tokens.cancel')"
      @confirm="confirmRemove"
      @cancel="pendingRemove = null"
    />
  </div>
</template>

<style scoped>
.token-sheet__wrap {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: flex;
  justify-content: flex-end;
}

.token-sheet__backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  animation: token-sheet-fade 160ms ease;
}

.token-sheet {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(92vw, 420px);
  height: 100%;
  padding: 12px;
  border-inline-start: 1px solid var(--border);
  background: var(--panel);
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.28);
  overflow-y: auto;
  animation: token-sheet-in 180ms ease;
}

@keyframes token-sheet-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes token-sheet-in {
  from {
    transform: translateX(100%);
  }
  to {
    transform: translateX(0);
  }
}

.token-sheet__head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.token-sheet__title {
  flex: 1 1 auto;
  margin: 0;
  font-size: 0.95rem;
  font-weight: 650;
  color: var(--text);
}

.token-sheet__hint {
  margin: 0;
  font-size: 0.76rem;
  line-height: 1.35;
  color: var(--muted);
}

.token-sheet__switch {
  display: flex;
  align-items: center;
  gap: 8px;
}

.token-sheet__toggle {
  padding: 5px 9px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--panel-2);
  color: var(--text);
  font: inherit;
  font-size: 0.78rem;
  cursor: pointer;
}

.token-sheet__toggle[aria-pressed="true"] {
  border-color: var(--accent);
  color: var(--accent);
}

.token-sheet__count {
  font-size: 0.74rem;
  color: var(--muted);
}

.token-sheet__warn,
.token-sheet__error {
  margin: 0;
  font-size: 0.76rem;
  color: var(--danger);
}

.token-sheet__notice {
  margin: 0;
  font-size: 0.76rem;
  color: var(--ok);
}

.token-sheet__empty {
  margin: 0;
  font-size: 0.8rem;
  color: var(--muted);
}

.token-sheet__table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.token-sheet__table th {
  padding: 4px 2px;
  border-bottom: 1px solid var(--border);
  font-size: 0.72rem;
  font-weight: 600;
  text-align: left;
  color: var(--muted);
}

.token-sheet__table td {
  padding: 4px 2px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  vertical-align: top;
}

.token-sheet__token-cell {
  width: 42%;
}

.token-sheet__row-actions {
  width: 82px;
  white-space: nowrap;
  text-align: right;
}

.token-sheet__token,
.token-sheet__value {
  display: inline-block;
  max-width: 100%;
  padding: 2px 4px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: none;
  color: var(--text);
  font: inherit;
  font-size: 0.78rem;
  text-align: left;
  overflow-wrap: anywhere;
  cursor: pointer;
}

.token-sheet__token {
  color: var(--accent);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.token-sheet__token:hover,
.token-sheet__value:hover {
  border-color: var(--border);
}

.token-sheet__icon {
  padding: 2px 5px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: none;
  color: var(--muted);
  font: inherit;
  font-size: 0.85rem;
  line-height: 1;
  cursor: pointer;
}

.token-sheet__icon:hover,
.token-sheet__icon:focus-visible {
  border-color: var(--border);
  color: var(--text);
}

.token-sheet__icon.is-insert:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.token-sheet__form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid color-mix(in srgb, var(--accent) 32%, var(--border));
  border-radius: 10px;
  background: var(--panel-2);
}

.token-sheet__field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 0.74rem;
  color: var(--muted);
}

.token-sheet__field input,
.token-sheet__field textarea {
  padding: 5px 7px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--panel);
  color: var(--text);
  font: inherit;
  font-size: 0.8rem;
  resize: vertical;
}

.token-sheet__field input:focus,
.token-sheet__field textarea:focus {
  outline: none;
  border-color: var(--accent);
}

/* Галочка «учитывать регистр»: свойство записи, а не диалога. */
.token-sheet__check {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.74rem;
  color: var(--muted);
  cursor: pointer;
}

.token-sheet__check input {
  width: 13px;
  height: 13px;
  margin: 0;
  accent-color: var(--accent);
  cursor: pointer;
}

.token-sheet__form-actions,
.token-sheet__foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.token-sheet__button {
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--panel);
  color: var(--text);
  font: inherit;
  font-size: 0.78rem;
  cursor: pointer;
}

.token-sheet__button:hover,
.token-sheet__button:focus-visible {
  border-color: var(--accent);
}

.token-sheet__button.is-primary {
  border-color: var(--accent);
  color: var(--accent);
}

.token-sheet__link {
  margin-inline-start: auto;
  padding: 2px 4px;
  border: none;
  background: none;
  color: var(--muted);
  font: inherit;
  font-size: 0.74rem;
  text-decoration: underline;
  cursor: pointer;
}

.token-sheet__visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
