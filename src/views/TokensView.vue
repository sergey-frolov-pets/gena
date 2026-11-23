<script setup lang="ts">
/**
 * Справочник подстановок: записи, ручной ввод, перенос файлом.
 *
 * Значения показываются по кнопке: по умолчанию строка замаскирована.
 * Экспорт и импорт — один файл и один пароль (см. `lib/tokens/transfer.ts`).
 */
import { onMounted, reactive, ref } from "vue";
import { useLocale } from "@/i18n";
import { isLocaleKey, type LocaleKey } from "@/i18n/types";
import {
  importTokenEntries,
  loadTokens,
  removeToken,
  saveToken,
  tokenEntries,
  tokensBroken,
  tokensLoaded,
  transferEntries,
  type TokenEntry,
} from "@/lib/tokens/registry";
import { findConflicts, type MergeConflict, type MergePolicy } from "@/lib/tokens/merge";
import {
  downloadMorph,
  loadMorph,
  morphProgress,
  morphStats,
  morphStatus,
  removeMorphDictionary,
} from "@/lib/tokens/morph/service";
import {
  checkTransferPassword,
  exportTokenFile,
  importTokenFile,
  TRANSFER_MIN_PASSWORD,
  type TransferEntry,
} from "@/lib/tokens/transfer";
import ConfirmModal from "@/components/ConfirmModal.vue";
import { loadNameBases, saveNameBases } from "@/lib/tokens/name-bases";

const { t, locale } = useLocale();

const error = ref("");
const notice = ref("");

const editingId = ref<string | null>(null);
const form = reactive({ name: "", value: "", variants: "", note: "", caseSensitive: false });
const revealed = ref<Set<string>>(new Set());
const savedId = ref("");

const filePassword = ref("");
const filePassword2 = ref("");
/** Текст выбранного файла: расшифровываем только по кнопке. */
const importText = ref("");
const importName = ref("");
const pending = ref<TransferEntry[] | null>(null);
const conflicts = ref<MergeConflict[]>([]);
const perEntry = ref(false);
const decisions = reactive<Record<string, MergePolicy>>({});
const importing = ref(false);
const exporting = ref(false);

const confirmDeleteId = ref("");

/** Скачать или обновить морфологический словарь. */
async function runDownloadMorph(): Promise<void> {
  await downloadMorph();
}

/** Убрать словарь с устройства: падежи снова только из ручных вариантов. */
async function runRemoveMorph(): Promise<void> {
  await removeMorphDictionary();
}

function formatMorphSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024 * 1024) return t("tokens.dict.kb", { value: Math.round(bytes / 1024) });
  return t("tokens.dict.mb", { value: (bytes / 1024 / 1024).toFixed(1) });
}

function formatLemmas(count: number): string {
  try {
    return new Intl.NumberFormat(locale.value).format(count);
  } catch {
    return String(count);
  }
}

const nameBasesText = ref(loadNameBases().join("\n"));

function saveBases(): void {
  const stored = saveNameBases(nameBasesText.value.split(/\n/));
  nameBasesText.value = stored.join("\n");
  notice.value = t("tokens.nameBasesSaved");
}

onMounted(async () => {
  void loadMorph();
  try {
    await loadTokens();
  } catch (e) {
    error.value = describe(e);
  }
});

/** Человеческий текст ошибки: по коду — перевод, иначе как есть. */
function describe(e: unknown): string {
  const code = (e as { code?: unknown }).code;
  if (typeof code === "string" && isLocaleKey(`tokens.error.${code}`)) {
    return t(`tokens.error.${code}` as LocaleKey, { min: TRANSFER_MIN_PASSWORD });
  }
  return e instanceof Error ? e.message : String(e);
}

function resetForm(): void {
  editingId.value = null;
  form.name = "";
  form.value = "";
  form.variants = "";
  form.note = "";
  form.caseSensitive = false;
}

function startEdit(entry: TokenEntry): void {
  error.value = "";
  notice.value = "";
  editingId.value = entry.id;
  form.name = entry.name;
  form.value = entry.value;
  form.variants = (entry.variants ?? []).join("\n");
  form.note = entry.note ?? "";
  form.caseSensitive = entry.caseSensitive === true;
  revealed.value = new Set([...revealed.value, entry.id]);
}

async function submit(): Promise<void> {
  error.value = "";
  notice.value = "";
  try {
    const saved = await saveToken({
      id: editingId.value ?? undefined,
      name: form.name,
      value: form.value,
      variants: form.variants.split("\n"),
      note: form.note,
      caseSensitive: form.caseSensitive,
    });
    savedId.value = saved.id;
    resetForm();
    notice.value = t("tokens.saved");
  } catch (e) {
    error.value = describe(e);
  }
}

function toggleReveal(id: string): void {
  const next = new Set(revealed.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  revealed.value = next;
}

function askDelete(id: string): void {
  confirmDeleteId.value = id;
}

async function confirmDelete(): Promise<void> {
  const id = confirmDeleteId.value;
  confirmDeleteId.value = "";
  if (!id) return;
  error.value = "";
  notice.value = "";
  try {
    await removeToken(id);
    if (editingId.value === id) resetForm();
    notice.value = t("tokens.deleted");
  } catch (e) {
    error.value = describe(e);
  }
}

function masked(entry: TokenEntry): string {
  const length = [...entry.value].length;
  return "•".repeat(Math.min(12, Math.max(4, length)));
}

/** Проверка пароля файла: пустой, короткий и несовпадающий — разные подсказки. */
function checkFilePassword(repeat: boolean): void {
  const problem = checkTransferPassword(filePassword.value);
  if (problem) throw Object.assign(new Error(problem), { code: problem });
  if (repeat && filePassword.value !== filePassword2.value) {
    throw Object.assign(new Error("password_mismatch"), { code: "password_mismatch" });
  }
}

function fileName(): string {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");
  return `gena-tokens-${stamp}.json`;
}

function download(name: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function runExport(): Promise<void> {
  error.value = "";
  notice.value = "";
  exporting.value = true;
  try {
    checkFilePassword(true);
    const entries = transferEntries();
    if (entries.length === 0) {
      throw Object.assign(new Error("no_entries"), { code: "no_entries" });
    }
    const file = await exportTokenFile(entries, filePassword.value);
    download(fileName(), file);
    filePassword.value = "";
    filePassword2.value = "";
    notice.value = t("tokens.transfer.exported", { count: entries.length });
  } catch (e) {
    error.value = describe(e);
  } finally {
    exporting.value = false;
  }
}

function pickFile(event: Event): void {
  error.value = "";
  notice.value = "";
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  importName.value = file.name;
  importText.value = "";
  void file.text().then((text) => {
    importText.value = text;
  });
}

async function runImport(): Promise<void> {
  error.value = "";
  notice.value = "";
  if (!importText.value) return;
  importing.value = true;
  try {
    checkFilePassword(false);
    const incoming = await importTokenFile(importText.value, filePassword.value);
    const found = findConflicts(tokenEntries.value, incoming);
    pending.value = incoming;
    if (found.length === 0) {
      await applyImport(() => "replace");
      return;
    }
    conflicts.value = found;
    perEntry.value = false;
    for (const key of Object.keys(decisions)) delete decisions[key];
    for (const conflict of found) decisions[conflict.nameKey] = "replace";
  } catch (e) {
    error.value = describe(e);
  } finally {
    importing.value = false;
  }
}

async function applyImport(decide: (conflict: MergeConflict) => MergePolicy): Promise<void> {
  if (!pending.value) return;
  const summary = await importTokenEntries(pending.value, decide);
  notice.value = t("tokens.transfer.imported", {
    added: summary.added,
    replaced: summary.replaced,
    kept: summary.kept,
  });
  pending.value = null;
  conflicts.value = [];
  perEntry.value = false;
  importText.value = "";
  importName.value = "";
  filePassword.value = "";
}

async function importReplaceAll(): Promise<void> {
  error.value = "";
  try {
    await applyImport(() => "replace");
  } catch (e) {
    error.value = describe(e);
  }
}

async function importKeepAll(): Promise<void> {
  error.value = "";
  try {
    await applyImport(() => "keep");
  } catch (e) {
    error.value = describe(e);
  }
}

async function importPerEntry(): Promise<void> {
  error.value = "";
  try {
    await applyImport((conflict) => decisions[conflict.nameKey] ?? "replace");
  } catch (e) {
    error.value = describe(e);
  }
}

function setDecision(key: string, policy: MergePolicy): void {
  decisions[key] = policy;
}
</script>

<template>
  <section>
    <h2>{{ t("tokens.title") }}</h2>
    <p class="muted small">{{ t("tokens.intro") }}</p>

    <p v-if="error" class="tokens-banner is-error" role="alert">{{ error }}</p>
    <p v-else-if="notice" class="tokens-banner is-ok" role="status">{{ notice }}</p>
    <p v-if="tokensBroken > 0" class="tokens-banner is-warn">
      {{ t("tokens.error.broken", { count: tokensBroken }) }}
    </p>

    <section class="tokens-dict">
      <h3 class="tokens-subtitle">{{ t("tokens.nameBases") }}</h3>
      <p class="muted small">{{ t("tokens.nameBasesHint") }}</p>
      <textarea v-model="nameBasesText" rows="4" :aria-label="t('tokens.nameBases')" />
      <div class="tokens-actions">
        <button type="button" class="is-primary" @click="saveBases">{{ t("tokens.save") }}</button>
      </div>
    </section>

    <section class="tokens-dict">
      <h3 class="tokens-subtitle">{{ t("tokens.dict.title") }}</h3>
      <p class="muted small">{{ t("tokens.dict.intro") }}</p>
      <p v-if="morphStatus === 'ready'" class="small">
        {{
          t("tokens.dict.ready", {
            lemmas: formatLemmas(morphStats?.lemmas ?? 0),
            size: formatMorphSize(morphStats?.bytes ?? 0),
          })
        }}
      </p>
      <p v-else-if="morphStatus === 'loading'" class="small">
        {{ t("tokens.dict.loading", { percent: Math.round(morphProgress * 100) }) }}
      </p>
      <p v-else-if="morphStatus === 'error'" class="tokens-banner is-error" role="alert">
        {{ t("tokens.dict.error") }}
      </p>
      <p v-else class="small muted">{{ t("tokens.dict.missing") }}</p>
      <progress
        v-if="morphStatus === 'loading'"
        class="tokens-dict__progress"
        :value="morphProgress"
        max="1"
      />
      <div class="tokens-actions">
        <button
          v-if="morphStatus !== 'ready'"
          type="button"
          class="is-primary"
          :disabled="morphStatus === 'loading'"
          @click="runDownloadMorph"
        >
          {{ t("tokens.dict.download") }}
        </button>
        <template v-else>
          <button type="button" @click="runDownloadMorph">
            {{ t("tokens.dict.update") }}
          </button>
          <button type="button" class="is-danger" @click="runRemoveMorph">
            {{ t("tokens.dict.remove") }}
          </button>
        </template>
      </div>
      <p class="muted small">{{ t("tokens.dict.priority") }}</p>
    </section>

    <form class="tokens-form" @submit.prevent="submit">
      <label class="tokens-field">
        <span>{{ t("tokens.name") }}</span>
        <input v-model="form.name" type="text" maxlength="80" :placeholder="t('tokens.namePlaceholder')" />
      </label>
      <label class="tokens-field">
        <span>{{ t("tokens.value") }}</span>
        <input v-model="form.value" type="text" :placeholder="t('tokens.valuePlaceholder')" />
      </label>
      <label class="tokens-field">
        <span>{{ t("tokens.variants") }}</span>
        <textarea v-model="form.variants" rows="3" />
        <small class="muted">{{ t("tokens.variantsHint") }}</small>
      </label>
      <label class="tokens-field">
        <span>{{ t("tokens.note") }}</span>
        <input v-model="form.note" type="text" :placeholder="t('tokens.notePlaceholder')" />
      </label>
      <label class="tokens-field tokens-field--check">
        <input v-model="form.caseSensitive" type="checkbox" />
        <span>{{ t("tokens.caseSensitive") }}</span>
      </label>
      <div class="tokens-actions">
        <button type="submit" class="is-primary">{{ t("tokens.save") }}</button>
        <button v-if="editingId" type="button" @click="resetForm">{{ t("tokens.cancel") }}</button>
      </div>
    </form>

    <p v-if="tokensLoaded && tokenEntries.length === 0" class="muted">{{ t("tokens.empty") }}</p>
    <ul v-else class="list tokens-list">
      <li v-for="entry in tokenEntries" :key="entry.id" :class="{ 'is-saved': entry.id === savedId }">
        <div class="tokens-row">
          <div class="tokens-main">
            <strong class="tokens-name">⟦{{ entry.name }}⟧</strong>
            <span class="tokens-value">
              {{ revealed.has(entry.id) ? entry.value : masked(entry) }}
            </span>
            <span v-if="entry.note" class="muted small">{{ entry.note }}</span>
            <span
              v-if="entry.caseSensitive"
              class="tokens-case"
              :title="t('tokens.caseSensitive')"
              :aria-label="t('tokens.caseSensitive')"
            >
              Aa
            </span>
            <span v-if="entry.variants && entry.variants.length" class="muted small">
              · {{ entry.variants.join(" · ") }}
            </span>
          </div>
          <div class="tokens-buttons">
            <button type="button" class="tokens-mini" @click="toggleReveal(entry.id)">
              {{ revealed.has(entry.id) ? t("tokens.hide") : t("tokens.reveal") }}
            </button>
            <button type="button" class="tokens-mini" @click="startEdit(entry)">
              {{ t("tokens.edit") }}
            </button>
            <button type="button" class="tokens-mini is-danger" @click="askDelete(entry.id)">
              {{ t("tokens.delete") }}
            </button>
          </div>
        </div>
      </li>
    </ul>

    <h3 class="tokens-subtitle">{{ t("tokens.transfer.title") }}</h3>
    <p class="muted small">{{ t("tokens.transfer.intro", { min: TRANSFER_MIN_PASSWORD }) }}</p>

    <div class="tokens-transfer">
      <label class="tokens-field">
        <span>{{ t("tokens.transfer.password") }}</span>
        <input v-model="filePassword" type="password" autocomplete="new-password" />
      </label>
      <label class="tokens-field">
        <span>{{ t("tokens.transfer.passwordRepeat") }}</span>
        <input v-model="filePassword2" type="password" autocomplete="new-password" />
      </label>
      <div class="tokens-actions">
        <button type="button" class="is-primary" :disabled="exporting" @click="runExport">
          {{ t("tokens.transfer.export") }}
        </button>
      </div>

      <div class="tokens-import">
        <label class="file-btn">
          <input type="file" accept="application/json,.json" @change="pickFile" />
          {{ importName || t("tokens.transfer.import") }}
        </label>
        <button type="button" :disabled="importing || !importText" @click="runImport">
          {{ t("tokens.transfer.import") }}
        </button>
      </div>
    </div>

    <div v-if="pending && conflicts.length > 0" class="tokens-conflict" role="group">
      <p class="tokens-conflict__text">
        {{ t("tokens.transfer.conflicts", { count: conflicts.length }) }}
      </p>
      <div class="tokens-actions">
        <button type="button" class="is-primary" @click="importReplaceAll">
          {{ t("tokens.transfer.replaceAll") }}
        </button>
        <button type="button" @click="importKeepAll">{{ t("tokens.transfer.keepAll") }}</button>
        <button type="button" @click="perEntry = !perEntry">
          {{ t("tokens.transfer.perEntry") }}
        </button>
      </div>
      <ul v-if="perEntry" class="tokens-conflict__list">
        <li v-for="conflict in conflicts" :key="conflict.nameKey">
          <span class="tokens-conflict__name">⟦{{ conflict.name }}⟧</span>
          <span class="tokens-conflict__choices">
            <label>
              <input
                type="radio"
                :name="`m-${conflict.nameKey}`"
                :checked="decisions[conflict.nameKey] !== 'keep'"
                @change="setDecision(conflict.nameKey, 'replace')"
              />
              {{ t("tokens.transfer.replaceOne") }}
            </label>
            <label>
              <input
                type="radio"
                :name="`m-${conflict.nameKey}`"
                :checked="decisions[conflict.nameKey] === 'keep'"
                @change="setDecision(conflict.nameKey, 'keep')"
              />
              {{ t("tokens.transfer.keepOne") }}
            </label>
          </span>
        </li>
      </ul>
      <div v-if="perEntry" class="tokens-actions">
        <button type="button" class="is-primary" @click="importPerEntry">
          {{ t("tokens.transfer.apply") }}
        </button>
      </div>
    </div>

    <ConfirmModal
      :open="confirmDeleteId !== ''"
      :title="t('tokens.delete')"
      :confirm-label="t('tokens.delete')"
      :cancel-label="t('tokens.cancel')"
      @confirm="confirmDelete"
      @cancel="confirmDeleteId = ''"
    />
  </section>
</template>

<style scoped>
.tokens-dict {
  margin: 14px 0 18px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
}
.tokens-dict__progress {
  width: 100%;
  height: 6px;
  margin: 6px 0 10px;
}
.tokens-banner {
  margin: 10px 0;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--border);
  font-size: 0.86rem;
}
.tokens-banner.is-error {
  border-color: var(--danger);
  color: var(--danger);
}
.tokens-banner.is-ok {
  border-color: var(--ok, #2f8f5b);
}
.tokens-banner.is-warn {
  border-color: var(--warn, #b98216);
}

.tokens-form,
.tokens-transfer {
  display: grid;
  gap: 10px;
  margin: 14px 0 18px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--panel-2);
}

.tokens-field {
  display: grid;
  gap: 5px;
  font-size: 0.86rem;
}

.tokens-field input,
.tokens-field textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--panel);
  color: var(--text);
  font: inherit;
}

/* Галочка «учитывать регистр» — свойство записи, а не серии замен. */
.tokens-field--check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: fit-content;
  cursor: pointer;
}

.tokens-field--check input {
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--accent);
  cursor: pointer;
}

.tokens-case {
  display: inline-flex;
  align-items: center;
  padding: 1px 5px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 0.68rem;
  color: var(--muted);
}

.tokens-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tokens-actions button {
  padding: 7px 14px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--panel);
  color: var(--text);
  font-size: 0.86rem;
  cursor: pointer;
}

.tokens-actions button.is-primary {
  border-color: var(--accent, #2f8f5b);
  background: var(--accent-soft, rgb(47 143 91 / 14%));
}

.tokens-list li {
  align-items: flex-start;
}

.tokens-row {
  display: flex;
  gap: 10px;
  width: 100%;
  justify-content: space-between;
  flex-wrap: wrap;
}

.tokens-main {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.tokens-name {
  font-size: 0.92rem;
}

.tokens-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.86rem;
  word-break: break-word;
}

.tokens-buttons {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.tokens-mini {
  padding: 4px 9px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  font-size: 0.78rem;
  cursor: pointer;
}

.tokens-mini.is-danger {
  border-color: var(--danger);
  color: var(--danger);
}

.tokens-list li.is-saved {
  border-color: var(--accent, #2f8f5b);
}

.tokens-subtitle {
  margin: 22px 0 4px;
  font-size: 0.98rem;
}

.tokens-import {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

.tokens-import button {
  padding: 7px 14px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--panel);
  color: var(--text);
  font-size: 0.86rem;
  cursor: pointer;
}

.tokens-conflict {
  margin: 14px 0;
  padding: 12px;
  border: 1px solid var(--warn, #b98216);
  border-radius: 12px;
  display: grid;
  gap: 10px;
}

.tokens-conflict__text {
  margin: 0;
  font-size: 0.88rem;
}

.tokens-conflict__list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 8px;
}

.tokens-conflict__list li {
  display: grid;
  gap: 4px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 9px;
}

.tokens-conflict__choices {
  display: flex;
  gap: 14px;
  font-size: 0.84rem;
}

.tokens-conflict__choices label {
  display: flex;
  gap: 5px;
  align-items: center;
}
</style>
