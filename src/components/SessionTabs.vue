<script setup lang="ts">
/**
 * Полоска недавних диалогов над чатом — как вкладки редактора в Cursor.
 *
 * Компонент только рисует и прокручивает активную вкладку в видимую зону.
 * Порядок вкладок и закрытые диалоги живут в `useSessionTabs`.
 */

import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useLocale } from "@/i18n";
import type { Session } from "@/storage/types";

const props = defineProps<{
  /** Видимые вкладки в сохранённом порядке: выбранная не переезжает в начало. */
  tabs: Session[];
  activeId: string | null;
  /** Диалоги, где агент отвечает или ждёт очереди. */
  busyIds: Set<string>;
}>();

const emit = defineEmits<{
  open: [id: string];
  close: [id: string];
  title: [title: string];
}>();

const { t } = useLocale();
const stripEl = ref<HTMLElement | null>(null);

/** Шеврон у края виден только тогда, когда в эту сторону есть что прокручивать. */
const canLeft = ref(false);
const canRight = ref(false);

/** Запас в пиксель: дробный scrollLeft после плавной прокрутки не должен мигать. */
const EDGE = 1;

function syncScroll(): void {
  const strip = stripEl.value;
  if (!strip) return;
  const max = strip.scrollWidth - strip.clientWidth;
  if (max <= EDGE) {
    canLeft.value = false;
    canRight.value = false;
    return;
  }
  canLeft.value = strip.scrollLeft > EDGE;
  canRight.value = strip.scrollLeft < max - EDGE;
}

/**
 * Сдвиг на «страницу» полоски. Шаг меньше ширины, чтобы крайняя вкладка
 * не терялась из вида между двумя нажатиями.
 */
function scrollTabs(dir: -1 | 1): void {
  const strip = stripEl.value;
  if (!strip) return;
  const page = Math.max(120, Math.round(strip.clientWidth * 0.7));
  strip.scrollBy({ left: dir * page, behavior: "smooth" });
}

/**
 * Выбранная вкладка должна быть видна целиком: если она ушла за край полоски
 * (часто на телефоне после открытия диалога из истории), прокручиваем её
 * к центру. Вертикальную прокрутку страницы не трогаем.
 */
function revealActive(): void {
  const strip = stripEl.value;
  if (!strip) return;
  const active = strip.querySelector<HTMLElement>(".chat-panel__tab.is-active");
  if (!active) return;
  const stripRect = strip.getBoundingClientRect();
  const tabRect = active.getBoundingClientRect();
  // Вкладка уже целиком в видимой части полоски — ничего не делаем.
  if (tabRect.left >= stripRect.left && tabRect.right <= stripRect.right) return;
  const centered =
    tabRect.left - stripRect.left + strip.scrollLeft - (strip.clientWidth - tabRect.width) / 2;
  strip.scrollLeft = Math.max(0, centered);
}

// Смена диалога или набора вкладок — активная вкладка снова на виду.
watch([() => props.activeId, () => props.tabs], () => void nextTick(() => {
  revealActive();
  syncScroll();
}), { flush: "post" });

// Полоска появляется и исчезает вместе с вкладками — следим за самим элементом.
let resizeObserver: ResizeObserver | null = null;
watch(stripEl, (strip) => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (strip && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => syncScroll());
    resizeObserver.observe(strip);
  }
  // Шрифт догрузился — ширины вкладок изменились, пересчитываем края.
  if (document.fonts) void document.fonts.ready.then(() => syncScroll());
  void nextTick(syncScroll);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<template>
  <div v-if="tabs.length" class="chat-panel__tabbar">
    <button
      v-show="canLeft"
      type="button"
      class="chat-panel__tabscroll is-left"
      :title="t('chat.tabsPrev')"
      :aria-label="t('chat.tabsPrev')"
      @click="scrollTabs(-1)"
    >
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M15 5l-7 7 7 7" />
      </svg>
    </button>

    <nav
      ref="stripEl"
      class="chat-panel__tabs"
      :aria-label="t('chat.dialogs')"
      @scroll.passive="syncScroll"
    >
      <div
        v-for="s in tabs"
        :key="s.id"
        class="chat-panel__tab"
        :class="{ 'is-active': s.id === activeId, 'is-busy': busyIds.has(s.id) }"
      >
        <button
          type="button"
          class="chat-panel__tab-open"
          :aria-current="s.id === activeId ? 'true' : undefined"
          :title="s.title"
          v-longpress="() => emit('title', s.title)"
          @click="emit('open', s.id)"
        >
          <span v-if="busyIds.has(s.id)" class="chat-panel__busy-dot" aria-hidden="true" />
          <span
            v-if="s.tokenMode"
            class="chat-panel__tab-lock"
            :title="t('chat.tokenMode')"
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 24 24"
              width="11"
              height="11"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="4" y="10" width="16" height="10" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
          </span>
          <span class="chat-panel__tab-title">{{ s.title }}</span>
        </button>
        <button
          type="button"
          class="chat-panel__tab-close"
          v-tip="t('chat.close')"
          :aria-label="t('chat.close')"
          @click.stop="emit('close', s.id)"
        >
          <svg
            viewBox="0 0 24 24"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </nav>

    <button
      v-show="canRight"
      type="button"
      class="chat-panel__tabscroll is-right"
      :title="t('chat.tabsNext')"
      :aria-label="t('chat.tabsNext')"
      @click="scrollTabs(1)"
    >
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M9 5l7 7-7 7" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
/* --- Полоска недавних диалогов: вкладки как в редакторе (Cursor/VS Code) -- */
/* Обёртка держит фон, линию-разделитель и шевроны прокрутки; сама полоска
   внутри — обычный горизонтальный скролл-контейнер. */
.chat-panel__tabbar {
  /* Полоса вкладок не сжимается по высоте: `overflow-x: auto` делает её ещё и
     скролл-контейнером (overflow-y становится auto), а значит min-height = 0,
     и при нехватке места вкладки сплющивались, а их верх обрезался краем панели. */
  position: relative;
  flex: 0 0 auto;
  display: flex;
  background: var(--panel-2);
}

/* Сплошная линия-разделитель под всей полосой; активная вкладка её перекрывает. */
.chat-panel__tabbar::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 1px;
  background: var(--border);
}

.chat-panel__tabs {
  flex: 1 1 auto;
  display: flex;
  align-items: flex-end;
  min-width: 0;
  gap: 2px;
  padding: 6px 8px 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  position: relative;
}

.chat-panel__tabs::-webkit-scrollbar {
  display: none;
}

.chat-panel__tab {
  display: flex;
  flex: 0 0 auto;
  position: relative;
  z-index: 1;
  align-items: center;
  min-height: 2.2rem;
  max-width: 11.5rem;
  border: 1px solid transparent;
  border-bottom-color: var(--border);
  border-radius: 8px 8px 0 0;
  background: transparent;
  color: var(--muted);
}

.chat-panel__tab:hover {
  background: color-mix(in srgb, var(--panel) 55%, transparent);
}

/* Активная вкладка сливается с полотном чата: её нижняя линия — цвета полотна. */
.chat-panel__tab.is-active {
  border-color: var(--border);
  border-bottom-color: var(--panel);
  background: var(--panel);
  color: var(--text);
}

/* Шевроны прокрутки: лежат поверх краёв полоски и проявляются, только когда
   в эту сторону есть скрытые вкладки. Фон — плавный переход в цвет полоски,
   чтобы подложка не читалась как отдельная плашка. */
.chat-panel__tabscroll {
  position: absolute;
  top: 0;
  bottom: 1px;
  z-index: 3;
  display: grid;
  place-items: center;
  width: 22px;
  padding: 0;
  border: 0;
  color: var(--muted);
  background: linear-gradient(to right, var(--panel-2) 58%, transparent);
  cursor: pointer;
}

.chat-panel__tabscroll.is-left {
  left: 0;
}

.chat-panel__tabscroll.is-right {
  right: 0;
  background: linear-gradient(to left, var(--panel-2) 58%, transparent);
}

.chat-panel__tabscroll:hover {
  color: var(--text);
}

/* Защищённый диалог: полоса и активная вкладка прозрачные, поэтому виден
   тот же градиент, что у ленты. Плоский --tokens-bg светлее или темнее. */
.chat-panel.is-tokens .chat-panel__tabbar {
  background: transparent;
}

.chat-panel.is-tokens .chat-panel__tabbar::after {
  background: transparent;
}

.chat-panel.is-tokens .chat-panel__tabscroll {
  color: var(--tokens-accent);
  background: linear-gradient(to right, var(--tokens-tint) 58%, transparent);
}

.chat-panel.is-tokens .chat-panel__tabscroll.is-right {
  background: linear-gradient(to left, var(--tokens-tint) 58%, transparent);
}

.chat-panel.is-tokens .chat-panel__tab.is-active {
  background: transparent;
  border-color: var(--tokens-edge);
  border-bottom-color: transparent;
}

.chat-panel__tab-open {
  display: flex;
  align-items: center;
  gap: 5px;
  align-self: stretch;
  min-height: 2.2rem;
  max-width: 9.2rem;
  padding: 0 4px 0 8px;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 0.78rem;
  line-height: 1.15;
  cursor: pointer;
}

.chat-panel__tab-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-panel__tab-close {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  margin-inline-end: 4px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s ease;
}

/* Крестик появляется у активной вкладки и при наведении — как в редакторе. */
.chat-panel__tab.is-active .chat-panel__tab-close,
.chat-panel__tab:hover .chat-panel__tab-close,
.chat-panel__tab-close:focus-visible {
  opacity: 1;
}

@media (hover: none) {
  .chat-panel__tab-close {
    opacity: 0.7;
  }
}

.chat-panel__tab-close:hover {
  background: color-mix(in srgb, var(--danger) 14%, transparent);
  color: var(--danger);
}

/* Телефон: вкладка читается, крестик попадает под палец.
   Очень узкий экран отдаёт ширину ленте — заголовки короче. */
@media (max-width: 720px) {
  .chat-panel__tab {
    min-height: 2.4rem;
    max-width: 10rem;
  }
  /* Шеврон — под палец, а не под курсор. */
  .chat-panel__tabscroll {
    width: 28px;
  }
  .chat-panel__tab-open {
    min-height: 2.4rem;
    max-width: 8.2rem;
    padding: 0 4px 0 8px;
    font-size: 0.84rem;
  }
  .chat-panel__tab-close {
    width: 28px;
    height: 28px;
    margin-inline-end: 2px;
  }
}

@media (max-width: 380px) {
  .chat-panel__tab {
    max-width: 7.2rem;
  }
  .chat-panel__tab-open {
    max-width: 5.6rem;
    font-size: 0.8rem;
  }
}

/* Агент отвечает (или реплика ждёт очереди) — диалог выделяем жирным. */
.chat-panel__tab.is-busy .chat-panel__tab-title {
  font-weight: 650;
  color: var(--text);
}

.chat-panel__tab-lock {
  display: inline-flex;
  align-items: center;
  margin-inline-end: 2px;
  color: var(--accent);
}
</style>
