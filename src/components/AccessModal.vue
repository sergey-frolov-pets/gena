<script setup lang="ts">
/**
 * Доступы к серверу: владелец выпускает коды, блокирует и отзывает их.
 * Гость видит объяснение режима — управление закрыто и на сервере (403).
 *
 * Код показывается один раз: сервер хранит только хеш, восстановить нельзя.
 */
import { computed, ref, watch } from "vue";
import { clientFor, type ServerAccess, type ServerProject } from "@/lib/gena-server";
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
/** Проекты сервера — для выбора области доступа. */
const projects = ref<ServerProject[]>([]);
/** Область нового кода: весь сервер или выбранные проекты. */
const draftScopeAll = ref(true);
const draftProjects = ref<string[]>([]);

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
    try {
      const all = await client.listProjects();
      projects.value = Array.isArray(all) ? all : [];
    } catch {
      // Проекты — подсказка для выбора области; без них коды выпускаются как раньше.
      projects.value = [];
    }
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
    draftScopeAll.value = true;
    draftProjects.value = [];
    freshCode.value = "";
    copied.value = false;
    confirmId.value = "";
    void load();
  },
);

async function createCode(): Promise<void> {
  if (!props.server || busy.value) return;
  // Пустой список проектов на сервере означает «весь сервер», поэтому
  // «ограничить, но ничего не выбрать» ловим на клиенте.
  if (!draftScopeAll.value && !draftProjects.value.length) {
    error.value = t("access.scopeEmpty");
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    const client = await clientFor(props.server);
    const days = Number(draftDays.value) || 0;
    const expiresAt = days > 0 ? Date.now() + days * 24 * 60 * 60 * 1000 : 0;
    const scope = draftScopeAll.value ? [] : [...draftProjects.value];
    const created = await client.createAccess(draftLabel.value.trim(), expiresAt, scope);
    freshCode.value = created.code;
    copied.value = false;
    draftLabel.value = "";
    draftScopeAll.value = true;
    draftProjects.value = [];
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

function projectName(id: string): string {
  return projects.value.find((project) => project.id === id)?.name || id;
}

/** Область кода одной строкой: «весь сервер» или перечень проектов. */
function scopeLabel(item: ServerAccess): string {
  const ids = item.projects ?? [];
  if (!ids.length) return t("access.scopeAll");
  return ids.map(projectName).join(", ");
}

function pickDraft(projectId: string): void {
  draftScopeAll.value = false;
  const next = draftProjects.value.includes(projectId)
    ? draftProjects.value.filter((id) => id !== projectId)
    : [...draftProjects.value, projectId];
  draftProjects.value = next;
  // Сняли последний проект — возвращаемся к «весь сервер», иначе сервер
  // поймёт пустой список как полный доступ.
  if (!next.length) draftScopeAll.value = true;
}

/** Меняет область уже выпущенного кода. Пустой список — весь сервер. */
async function patchScope(item: ServerAccess, next: string[]): Promise<void> {
  if (!props.server || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const client = await clientFor(props.server);
    const updated = await client.patchAccess(item.id, { projects: next });
    item.projects = Array.isArray(updated.projects) ? updated.projects : [];
  } catch (e) {
    error.value = describe(e);
  } finally {
    busy.value = false;
  }
}

function toggleProject(item: ServerAccess, projectId: string): void {
  const current = item.projects ?? [];
  const next = current.includes(projectId)
    ? current.filter((id) => id !== projectId)
    : [...current, projectId];
  void patchScope(item, next);
}

function allowWholeServer(item: ServerAccess): void {
  if ((item.projects ?? []).length === 0) return;
  void patchScope(item, []);
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
          <div class="access-modal__scope">
            <span class="access-modal__scope-title">{{ t("access.scope") }}</span>
            <div class="access-modal__chips">
              <button
                type="button"
                class="access-modal__chip"
                :class="{ 'is-on': draftScopeAll }"
                :aria-pressed="draftScopeAll"
                @click="draftScopeAll = true; draftProjects = []"
              >
                {{ t("access.scopeAll") }}
              </button>
              <button
                v-for="project in projects"
                :key="project.id"
                type="button"
                class="access-modal__chip"
                :class="{ 'is-on': !draftScopeAll && draftProjects.includes(project.id) }"
                :aria-pressed="!draftScopeAll && draftProjects.includes(project.id)"
                @click="pickDraft(project.id)"
              >
                {{ project.name }}
              </button>
            </div>
            <p class="muted small">{{ t("access.scopeHint") }}</p>
          </div>
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
            <div class="access-modal__scope">
              <span class="access-modal__scope-title">{{ t("access.scope") }}: {{ scopeLabel(item) }}</span>
              <div class="access-modal__chips">
                <button
                  type="button"
                  class="access-modal__chip"
                  :class="{ 'is-on': !(item.projects ?? []).length }"
                  :disabled="busy"
                  @click="allowWholeServer(item)"
                >
                  {{ t("access.scopeAll") }}
                </button>
                <button
                  v-for="project in projects"
                  :key="project.id"
                  type="button"
                  class="access-modal__chip"
                  :class="{ 'is-on': (item.projects ?? []).includes(project.id) }"
                  :disabled="busy"
                  @click="toggleProject(item, project.id)"
                >
                  {{ project.name }}
                </button>
              </div>
            </div>
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

.access-modal__scope {
  display: flex;
  flex: 1 1 100%;
  flex-direction: column;
  gap: 6px;
}

.access-modal__scope-title {
  font-size: 0.82rem;
  color: var(--muted);
}

.access-modal__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.access-modal__chip {
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  font-size: 0.8rem;
  cursor: pointer;
}

.access-modal__chip.is-on {
  border-color: var(--accent, #4f8cff);
  background: var(--panel-2);
  color: var(--text);
}

.access-modal__chip:disabled {
  opacity: 0.6;
  cursor: default;
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

