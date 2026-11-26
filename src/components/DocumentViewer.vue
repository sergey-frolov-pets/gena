<script setup lang="ts">
/**
 * Просмотр текстовых файлов из ленты: markdown, csv/tsv, обычный текст.
 *
 * Плашка файла в чате раньше сразу скачивала его. Теперь клик открывает
 * модалку: markdown рендерится, csv/tsv — таблицей, остальное — как есть.
 * Кнопка «На весь экран» разворачивает карточку на всё окно, «Исходник»
 * показывает необработанный текст. Закрытие — Esc, клик по фону, крестик.
 */
import { nextTick, onBeforeUnmount, ref, watch } from "vue";

import { saveBlob } from "@/lib/media";
import { toCsv, toTsv, xlsxBlob } from "@/lib/table-file";
import type { ViewerLabels } from "@/lib/text-viewer";

const props = defineProps<{
  open: boolean;
  name: string;
  /** Готовый HTML тела (рендер markdown / таблица / `<pre>`). */
  html: string;
  /** Исходный текст файла для режима «Исходник» и копирования. */
  source: string;
  loading: boolean;
  error: string;
  labels: ViewerLabels;
}>();

const emit = defineEmits<{ close: []; download: []; share: [] }>();

const expanded = ref(false);
const showSource = ref(false);
const card = ref<HTMLElement | null>(null);
let restoreFocus: HTMLElement | null = null;
let previousOverflow = "";

function close(): void {
  emit("close");
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    close();
    return;
  }
  if (event.key !== "Tab" || !card.value) return;
  // Модалка заявляет aria-modal: фокус не должен уходить в чат за ней.
  const focusable = card.value.querySelectorAll<HTMLElement>(
    'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
  );
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === card.value)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

/** Копирование и выгрузка таблиц внутри просмотрщика (те же кнопки, что в ленте). */
async function onBodyClick(event: MouseEvent): Promise<void> {
  const target = event.target as HTMLElement | null;
  const copyButton = target?.closest(".md-code__copy");
  if (copyButton instanceof HTMLElement) {
    event.preventDefault();
    event.stopPropagation();
    const code = copyButton.closest(".md-code")?.querySelector("code")?.textContent ?? "";
    if (!code) return;
    await copyText(code, copyButton, "md-code__copy--done");
    return;
  }
  const tableTool = target?.closest(".md-table__tool");
  if (!(tableTool instanceof HTMLElement)) return;
  event.preventDefault();
  event.stopPropagation();
  const table = tableTool.closest(".md-table")?.querySelector("table");
  if (!(table instanceof HTMLTableElement)) return;
  const rows = [...table.rows].map((row) =>
    [...row.cells].map((cell) => (cell.textContent ?? "").replace(/\s+/g, " ").trim()),
  );
  if (tableTool.classList.contains("md-table__copy")) {
    await copyText(toTsv(rows), tableTool, "md-table__tool--done");
    return;
  }
  if (tableTool.classList.contains("md-table__xlsx")) {
    saveBlob(xlsxBlob(rows), "table.xlsx");
    return;
  }
  saveBlob(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }), "table.csv");
}

async function copyText(text: string, button: HTMLElement, doneClass: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else copyFallback(text);
  } catch {
    copyFallback(text);
  }
  button.classList.add(doneClass);
  window.setTimeout(() => button.classList.remove(doneClass), 1400);
}

/** Копирование без Clipboard API (http, старые вебвью на телефоне). */
function copyFallback(text: string): void {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    document.execCommand("copy");
  } catch {
    // Не вышло — текст виден на экране, этого достаточно.
  }
  area.remove();
}

function lockScroll(): void {
  previousOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
}

function unlockScroll(): void {
  document.body.style.overflow = previousOverflow;
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      expanded.value = false;
      showSource.value = false;
      restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      window.addEventListener("keydown", onKeydown, true);
      lockScroll();
      await nextTick();
      card.value?.focus();
    } else {
      window.removeEventListener("keydown", onKeydown, true);
      unlockScroll();
      restoreFocus?.focus?.();
      restoreFocus = null;
    }
  },
);

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown, true);
  if (props.open) unlockScroll();
});
</script>

<template>
  <div
    v-if="open"
    class="doc-viewer"
    role="dialog"
    aria-modal="true"
    :aria-label="name"
    @click.self="close"
  >
    <div ref="card" class="doc-viewer__card" :class="{ 'is-expanded': expanded }" tabindex="-1">
      <header class="doc-viewer__head">
        <div class="doc-viewer__title">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path d="M14 3v5h5" />
          </svg>
          <span class="doc-viewer__name" :title="name">{{ name }}</span>
        </div>
        <div class="doc-viewer__tools">
          <button
            type="button"
            class="doc-viewer__btn"
            :aria-pressed="showSource"
            :title="showSource ? labels.rendered : labels.source"
            @click="showSource = !showSource"
          >
            {{ showSource ? labels.rendered : labels.source }}
          </button>
          <button type="button" class="doc-viewer__btn" :title="labels.download" @click="emit('download')">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 4v11" />
              <path d="m7 11 5 5 5-5" />
              <path d="M5 20h14" />
            </svg>
            <span class="doc-viewer__btn-text">{{ labels.download }}</span>
          </button>
          <button type="button" class="doc-viewer__btn" :title="labels.share" @click="emit('share')">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 16V5" />
              <path d="m8 8 4-3 4 3" />
              <path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
            </svg>
            <span class="doc-viewer__btn-text">{{ labels.share }}</span>
          </button>
          <button
            type="button"
            class="doc-viewer__btn doc-viewer__btn--icon"
            :title="expanded ? labels.collapse : labels.expand"
            :aria-label="expanded ? labels.collapse : labels.expand"
            @click="expanded = !expanded"
          >
            <svg v-if="expanded" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M9 4v5H4" />
              <path d="M15 20v-5h5" />
              <path d="M20 9h-5V4" />
              <path d="M4 15h5v5" />
            </svg>
            <svg v-else viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M4 9V4h5" />
              <path d="M20 15v5h-5" />
              <path d="M15 4h5v5" />
              <path d="M9 20H4v-5" />
            </svg>
          </button>
          <button
            type="button"
            class="doc-viewer__btn doc-viewer__btn--icon"
            :title="labels.close"
            :aria-label="labels.close"
            @click="close"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      </header>

      <div class="doc-viewer__body" @click="onBodyClick">
        <p v-if="loading" class="doc-viewer__state">{{ labels.loading }}</p>
        <div v-else-if="error" class="doc-viewer__state">
          <p>{{ error }}</p>
          <button type="button" class="doc-viewer__btn" @click="emit('download')">
            {{ labels.download }}
          </button>
        </div>
        <pre v-else-if="showSource" class="doc-viewer__pre">{{ source }}</pre>
        <p v-else-if="!html" class="doc-viewer__state">{{ labels.empty }}</p>
        <!-- HTML приходит из lib/markdown.ts: только allowlist тегов и атрибутов. -->
        <div v-else class="doc-viewer__md md" v-html="html"></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.doc-viewer {
  position: fixed;
  inset: 0;
  z-index: 9990;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgb(0 0 0 / 68%);
  backdrop-filter: blur(2px);
}

.doc-viewer__card {
  display: flex;
  flex-direction: column;
  width: min(52rem, 100%);
  height: min(80vh, 100%);
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--panel);
  box-shadow: 0 24px 64px rgb(0 0 0 / 38%);
}

.doc-viewer__card.is-expanded {
  width: 100%;
  height: 100%;
  border-radius: 0;
}

.doc-viewer__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 8px 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--panel-2);
}

.doc-viewer__title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--muted);
}

.doc-viewer__name {
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 0.84rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc-viewer__tools {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-inline-start: auto;
}

.doc-viewer__btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--panel);
  color: var(--text);
  font-size: 0.78rem;
  line-height: 1;
  cursor: pointer;
}

.doc-viewer__btn:hover,
.doc-viewer__btn:focus-visible {
  border-color: var(--accent);
  color: var(--accent);
}

.doc-viewer__btn--icon {
  width: 32px;
  padding: 0;
  justify-content: center;
}

.doc-viewer__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 16px 20px 24px;
  -webkit-overflow-scrolling: touch;
}

/* Длинный файл читается в колонку ~72 символа, а не в 1400px строку. */
.doc-viewer__md {
  max-width: 72ch;
  margin: 0 auto;
  font-size: 0.92rem;
  line-height: 1.55;
}

.doc-viewer__pre {
  max-width: 100%;
  margin: 0;
  color: var(--text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.8rem;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.doc-viewer__state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  margin: 32px auto;
  color: var(--muted);
  font-size: 0.86rem;
  text-align: center;
}

@media (max-width: 600px) {
  .doc-viewer {
    padding: 0;
  }

  .doc-viewer__card,
  .doc-viewer__card.is-expanded {
    width: 100%;
    height: 100%;
    border-radius: 0;
    border: 0;
  }

  .doc-viewer__body {
    padding: 12px 14px 20px;
  }

  /* На телефоне подписи кнопок съедают место — остаются иконки. */
  .doc-viewer__btn-text {
    display: none;
  }
}
</style>
