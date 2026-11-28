<script setup lang="ts">
/**
 * Доступы к серверу: владелец выпускает коды, блокирует и отзывает их.
 * Гость видит объяснение режима — управление закрыто и на сервере (403).
 *
 * Код показывается один раз: сервер хранит только хеш, восстановить нельзя.
 */
import { computed, ref, watch } from "vue";
import { clientFor, type ServerAccess } from "@/lib/gena-server";
import type { GenaServer } from "@/storage/types";
import { useLocale } from "@/i18n";

const props = defineProps<{ open: boolean; server: GenaServer | null }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useLocale();

const items = ref<ServerAccess[]>([]);
const max = ref(0);
const role = ref<"owner" | "guest">("owner");
const busy = ref(false);
const error = ref("");
const freshCode = ref("");
const copied = ref(false);
const draftLabel = ref("");
const draftDays = ref(30);
const confirmId = ref("");

const canManage = computed(() => role.value === "owner");
const dayOptions = computed(() => [7, 30, 90, 0]);
const limitHint = computed(() =>
  max.value ? t("access.limit", { count: items.value.length, max: max.value }) : "",
);
/** Достигнут потолок кодов — кнопка выпуска гаснет, чтобы не ловить 409 с сервера. */
const limitReached = computed(() => max.value > 0 && items.value.length >= max.value);

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function load(): Promise<void> {
  if (!props.server) return;
  busy.value = true;
  error.value = "";
  try {
    const client = await clientFor(props.server);
    const status = await client.status();
    role.value = status.role === "guest" ? "guest" : "owner";
    if (role.value !== "owner") {
      items.value = [];
      return;
    }
    const list = await client.listAccess();
    items.value = Array.isArray(list?.items) ? list.items : [];
    max.value = Number(list?.max) || 0;
  } catch (e) {
    error.value = t("access.failed", { error: describe(e) });
  } finally {
    busy.value = false;
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    draftLabel.value = "";
    draftDays.value = 30;
    freshCode.value = "";
    copied.value = false;
    confirmId.value = "";
    void load();
  },
);

async function createCode(): Promise<void> {
  if (!props.server || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const client = await clientFor(props.server);
    const days = Number(draftDays.value) || 0;
    const expiresAt = days > 0 ? Date.now() + days * 24 * 60 * 60 * 1000 : 0;
    const created = await client.createAccess(draftLabel.value.trim(), expiresAt);
    freshCode.value = created.code;
    copied.value = false;
    draftLabel.value = "";
    await load();
  } catch (e) {
    error.value = describe(e);
  } finally {
    busy.value = false;
  }
}

async function copyCode(): Promise<void> {
  if (!freshCode.value) return;
  try {
    await navigator.clipboard.writeText(freshCode.value);
    copied.value = true;
  } catch {
    copied.value = false;
  }
}

async function toggleBlocked(item: ServerAccess): Promise<void> {
  if (!props.server || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const client = await clientFor(props.server);
    await client.patchAccess(item.id, { blocked: !item.blocked });
    await load();
  } catch (e) {
    error.value = describe(e);
  } finally {
    busy.value = false;
  }
}

async function remove(item: ServerAccess): Promise<void> {
  if (!props.server || busy.value) return;
  confirmId.value = "";
  busy.value = true;
  error.value = "";
  try {
    const client = await clientFor(props.server);
    await client.deleteAccess(item.id);
    await load();
  } catch (e) {
    error.value = describe(e);
  } finally {
    busy.value = false;
  }
}

/** Статус кода одной строкой: просрочен важнее блокировки — код уже не работает. */
function stateOf(item: ServerAccess): string {
  if (item.expiresAt && item.expiresAt < Date.now()) return t("access.expired");
  if (item.blocked) return t("access.blocked");
  return "";
}

function stamp(ms?: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString();
}

function metaOf(item: ServerAccess): string {
  const parts = [t("access.created", { when: stamp(item.createdAt) })];
  parts.push(item.lastSeenAt ? t("access.lastSeen", { when: stamp(item.lastSeenAt) }) : t("access.neverSeen"));
  if (item.expiresAt) parts.push(t("access.expires") + " " + stamp(item.expiresAt));
  return parts.join(" · ");
}
</script>

<template>
  <div v-if="open" class="access-modal" role="dialog" aria-modal="true" :aria-label="t('access.title')">
    <div class="access-modal__backdrop" @click="emit('close')" />
    <div class="access-modal__card">
      <header class="access-modal__head">
        <h3 class="access-modal__title">{{ t("access.title") }}</h3>
        <span class="badge">{{ canManage ? t("access.roleOwner") : t("access.roleGuest") }}</span>
        <button type="button" class="icon-btn" :aria-label="t('access.close')" @click="emit('close')">
          ✕
        </button>
      </header>
      <div class="muted small">{{ server?.name }} · {{ server?.url }}</div>

      <p v-if="!canManage" class="muted small">{{ t("access.guestHint") }}</p>

      <template v-else>
        <p class="muted small">{{ t("access.subtitle") }}</p>

        <div class="access-modal__form">
          <label class="access-modal__field">
            <span>{{ t("access.label") }}</span>
            <input v-model="draftLabel" type="text" :placeholder="t('access.labelPlaceholder')" :maxlength="40" />
          </label>
          <label class="access-modal__field">
            <span>{{ t("access.expires") }}</span>
            <select v-model.number="draftDays">
              <option v-for="days in dayOptions" :key="days" :value="days">
                {{ days ? t("access.days", { count: days }) : t("access.never") }}
              </option>
            </select>
          </label>
          <button type="button" class="access-modal__btn is-primary" :disabled="busy || limitReached" @click="createCode">
            {{ t("access.create") }}
          </button>
        </div>

        <p v-if="freshCode" class="access-modal__fresh">
          <span>{{ t("access.codeReady") }}</span>
          <code>{{ freshCode }}</code>
          <button type="button" class="access-modal__btn" @click="copyCode">
            {{ copied ? t("access.copied") : t("access.copy") }}
          </button>
        </p>

        <p v-if="error" class="error small">{{ error }}</p>
        <p v-if="busy" class="muted small">…</p>

        <p v-if="!items.length" class="muted small">{{ t("access.empty") }}</p>
        <ul v-else class="access-modal__list">
          <li v-for="item in items" :key="item.id" class="access-modal__item">
            <div class="access-modal__row">
              <strong>{{ item.label || "—" }}</strong>
              <span v-if="stateOf(item)" class="badge">{{ stateOf(item) }}</span>
            </div>
            <div class="muted small">{{ metaOf(item) }}</div>
            <div class="access-modal__row">
              <button type="button" class="access-modal__btn" :disabled="busy" @click="toggleBlocked(item)">
                {{ item.blocked ? t("access.unblock") : t("access.block") }}
              </button>
              <button
                type="button"
                class="access-modal__btn is-danger"
                :disabled="busy"
                @click="confirmId = item.id"
              >
                {{ t("access.remove") }}
              </button>
            </div>
            <p v-if="confirmId === item.id" class="small">
              {{ t("access.removeConfirm", { label: item.label || "—" }) }}
              <button type="button" class="access-modal__btn is-danger" @click="remove(item)">
                {{ t("access.remove") }}
              </button>
              <button type="button" class="access-modal__btn" @click="confirmId = ''">
                {{ t("chat.cancel") }}
              </button>
            </p>
          </li>
        </ul>
        <p v-if="limitHint" class="muted small">{{ limitHint }}</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.access-modal {
  position: fixed;
  inset: 0;
  z-index: 9500;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.access-modal__backdrop {
  position: absolute;
  inset: 0;
  background: rgb(0 0 0 / 55%);
  backdrop-filter: blur(2px);
}

.access-modal__card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: min(520px, 100%);
  max-height: min(88vh, 720px);
  overflow-y: auto;
  padding: 18px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--panel);
  box-shadow: 0 18px 48px rgb(0 0 0 / 32%);
}

.access-modal__head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.access-modal__title {
  margin: 0;
  font-size: 1rem;
}

.access-modal__form {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 8px;
}

.access-modal__field {
  display: flex;
  flex: 1 1 140px;
  flex-direction: column;
  gap: 4px;
  font-size: 0.82rem;
  color: var(--muted);
}

.access-modal__field input,
.access-modal__field select {
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--panel-2);
  color: var(--text);
  font-size: 0.88rem;
}

.access-modal__fresh {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 10px;
  border: 1px dashed var(--border);
  border-radius: 10px;
  font-size: 0.85rem;
}

.access-modal__fresh code {
  flex: 1 1 100%;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--panel-2);
  font-size: 0.92rem;
  word-break: break-all;
}

.access-modal__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.access-modal__item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
}

.access-modal__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.access-modal__btn {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--panel-2);
  color: var(--text);
  font-size: 0.84rem;
  cursor: pointer;
}

.access-modal__btn.is-primary {
  border-color: var(--accent, #4f8cff);
  background: var(--accent, #4f8cff);
  color: #fff;
}

.access-modal__btn.is-danger {
  border-color: var(--danger);
  color: var(--danger);
}

.access-modal__btn:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>

