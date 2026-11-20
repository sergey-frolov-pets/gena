<script setup lang="ts">
/**
 * Чат Gena. Разметка и стили — порт `AiChatPanel` из code2graph
 * (toolbar → stage с пузырями → dock с композером), данные и транспорт — Gena.
 * Голос: диктовка (Web Speech) и озвучка ответов (Speech Synthesis).
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import {
  activeSessionId,
  agents,
  appendMessage,
  clearMessages,
  createSession,
  deleteMessagesFrom,
  duplicateSession,
  getAgentKey,
  loadMessages,
  messages,
  pinSession,
  removeMessage,
  removeSession,
  renameSession,
  sessions,
  sessionsLoaded,
} from "@/lib/store";
import { newId } from "@/lib/id";
import { isSendKey } from "@/lib/composer";
import { listenToAgent, sendToAgent, type TransportAttachment } from "@/lib/agent-client";
import { describeError } from "@/lib/errors";
import { renderMarkdown } from "@/lib/markdown";
import { canCall, getCallCount, recordCall } from "@/storage/usage";
import { listMessages } from "@/storage/db";
import { useLocale } from "@/i18n";
import {
  dictationAvailable,
  dictationError,
  dictationListening,
  stopDictation,
  toggleDictation,
} from "@/lib/dictation";
import {
  autoSpeak,
  SPEECH_RATES,
  setAutoSpeak,
  setSpeechRate,
  speak,
  speakingId,
  speechAvailable,
  speechRate,
  toggleSpeech,
} from "@/lib/speech";
import {
  DocumentError,
  documentKindOf,
  documentsToMessage,
  formatBytes,
  prepareDocument,
  type PreparedDocument,
} from "@/lib/documents";
import type { Agent, Message, MessageAttachment, Session } from "@/storage/types";
import { ImageError, prepareImage, type PreparedImage } from "@/lib/images";
import { attachmentFromBlobUrl, fetchMediaBlob, getCachedMedia } from "@/lib/media";
import {
  collectTrailingThoughts,
  collectTurnThoughts,
  thoughtText,
  withoutToolCalls,
} from "@/lib/turns";
import {
  isPendingFresh,
  shouldResume,
  type PendingTurn,
} from "@/lib/resume";
import { readQueued, toPersisted, type RestoredQueue } from "@/lib/queue";
import { listQueued, replaceQueued } from "@/storage/queue";
import { answerElapsed, formatClock, formatDuration } from "@/lib/time";
import ConfirmModal from "@/components/ConfirmModal.vue";
import TextModal from "@/components/TextModal.vue";

const { t } = useLocale();

const agentId = ref("");
const draft = ref("");
const busy = ref(false);
const typing = ref(false);
const error = ref("");
const notice = ref("");
/** Таймер автоскрытия строки статуса — плашка не должна висеть как ошибка. */
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

/** Показать строку статуса (служебная плашка сервера, а не ошибка). */
function showNotice(text: string, ttl = 12_000): void {
  notice.value = text;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    noticeTimer = null;
    if (notice.value === text) notice.value = "";
  }, ttl);
}
/** Сколько вызовов сделано сегодня у выбранного агента. */
const usedToday = ref(0);
/** Последний отправленный текст — для кнопки «Повторить». */
const lastText = ref("");
/** Контроллер отмены текущего хода. */
const abortCtrl = ref<AbortController | null>(null);
/** Накопленный текст стриминга. */
const streamingText = ref("");
/** Сессия, к которой относится текущий стрим (чтобы не показывать его в другом диалоге). */
const streamSessionId = ref<string | null>(null);

/* ── Часы хода: сколько идёт текущий ответ ─────────────────────────────── */

/** Когда отправлен запрос; null — хода нет. */
const turnStartedAt = ref<number | null>(null);
/** Тикающая метка времени для живого счётчика. */
const clockNow = ref(Date.now());
let clockTimer: ReturnType<typeof setInterval> | null = null;

/** Запустить счётчик текущего хода. */
function startTurnClock(at = Date.now()): void {
  turnStartedAt.value = at;
  clockNow.value = at;
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = setInterval(() => {
    clockNow.value = Date.now();
  }, 500);
}

/** Погасить счётчик: ход завершён. */
function stopTurnClock(): void {
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = null;
  turnStartedAt.value = null;
}

/** Подписи единиц длительности из словаря. */
const durationUnits = computed(() => ({
  h: t("chat.time.h"),
  m: t("chat.time.m"),
  s: t("chat.time.s"),
}));

/** Сколько идёт текущий ответ — «7 с». Пусто, когда хода нет. */
const liveElapsed = computed(() => {
  if (turnStartedAt.value === null) return "";
  return formatDuration(Math.max(0, clockNow.value - turnStartedAt.value), durationUnits.value);
});

/** Время сообщения: часы появления в чате. */
function messageClock(message: Message): string {
  return formatClock(message.createdAt);
}

/** Длительность ответа для сообщения ленты: «42 с» или пусто. */
function messageElapsed(index: number): string {
  const ms = answerElapsed(feed.value, index);
  return ms === null ? "" : formatDuration(ms, durationUnits.value);
}
/** Контейнер сообщений — для автоскролла. */
const messagesEl = ref<HTMLElement | null>(null);
/** Обёртка контента: её рост (картинки, шаги) возвращает нас к низу. */
const threadEl = ref<HTMLElement | null>(null);
let threadObserver: ResizeObserver | null = null;
/** Поле ввода — чтобы вернуть фокус после отправки. */
const composerEl = ref<HTMLTextAreaElement | null>(null);
/** Шит истории диалогов (как в AiChatPanel). */
const historyOpen = ref(false);
const historyQuery = ref("");
/** Режим переименования диалога в шапке. */
const renaming = ref(false);
const renameDraft = ref("");
/** Что только что скопировали — для галочки «Скопировано». */
const copiedId = ref("");
/** Изображения, готовые к отправке (полный data-URL живёт только в памяти). */
const pendingImages = ref<PreparedImage[]>([]);
/** Локализованная ошибка подготовки вложения. */
const attachError = ref("");
/** Скрытый input[type=file] для кнопки-скрепки. */
const fileInput = ref<HTMLInputElement | null>(null);
/** Просмотр изображения на весь экран. */
const lightbox = ref("");
/** Документы, из которых уже извлечён текст (уходят в сообщении). */
const pendingDocs = ref<PreparedDocument[]>([]);
/** Ошибка чтения документа — отдельно от ошибок изображений. */
const fileError = ref("");
const MAX_IMAGES = 5;
const MAX_DOCUMENTS = 5;

/* ── Черновик и незавершённый ход ─────────────────────────────────────── */

const DRAFT_PREFIX = "gena.chat.draft.";
const PENDING_KEY = "gena.chat.pending";
const MAX_PENDING = 5;

function readText(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeText(key: string, value: string): void {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Приватный режим или отключённое хранилище — живём без сохранения.
  }
}

function draftKey(id: string | null): string {
  return `${DRAFT_PREFIX}${id ?? "new"}`;
}

let draftTimer: ReturnType<typeof setTimeout> | null = null;

/** Черновик сохраняется с задержкой, чтобы не писать в localStorage на каждый символ. */
function saveDraftSoon(): void {
  if (draftTimer) clearTimeout(draftTimer);
  const key = draftKey(activeSessionId.value);
  const value = draft.value;
  draftTimer = setTimeout(() => {
    writeText(key, value);
  }, 200);
}

/** Восстановить черновик диалога (или «нового»). */
function restoreDraft(id: string | null): void {
  draft.value = readText(draftKey(id));
  void autoGrow();
}

/** Записать черновик немедленно — перед закрытием вкладки/уходом со страницы. */
function flushDraft(): void {
  if (draftTimer) {
    clearTimeout(draftTimer);
    draftTimer = null;
  }
  writeText(draftKey(activeSessionId.value), draft.value);
}

/** Уходим со страницы — забранная реплика возвращается в ленту, текст остаётся в поле. */
function restoreLiftOnHide(): void {
  if (lifted.value) lifted.value = null;
}

function readPending(): PendingTurn[] {
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list.filter(
      (item): item is PendingTurn =>
        Boolean(item) &&
        typeof (item as PendingTurn).sessionId === "string" &&
        typeof (item as PendingTurn).text === "string" &&
        typeof (item as PendingTurn).at === "number",
    );
  } catch {
    return [];
  }
}

function writePending(list: PendingTurn[]): void {
  writeText(PENDING_KEY, JSON.stringify(list.slice(-MAX_PENDING)));
}

function rememberPending(turn: PendingTurn): void {
  const list = readPending();
  // Уже сохранён — не сдвигаем время: TTL считается от первой отправки.
  if (list.some((item) => item.sessionId === turn.sessionId && item.text === turn.text)) return;
  list.push(turn);
  writePending(list);
}

function forgetPending(sessionId: string, text: string): void {
  writePending(
    readPending().filter((item) => !(item.sessionId === sessionId && item.text === text)),
  );
}

/** Последний незавершённый ход этого диалога. */
function pendingFor(sessionId: string): PendingTurn | null {
  const list = readPending().filter((item) => item.sessionId === sessionId);
  return list.length > 0 ? list[list.length - 1] : null;
}

/* ── Окно ввода на телефоне: по тапу, поверх чата ─────────────────────── */

const compact = ref(
  typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches,
);
const composerOpen = ref(!compact.value);
const composerForm = ref<HTMLFormElement | null>(null);

/* ── Стандартные сообщения: кнопки над композером ─────────────────────── */

/** Панель открыта (одна на док и на композер). */
const quickOpen = ref(false);
/** Стандартные сообщения выбранного агента — нормализованы при чтении/сохранении. */
const quickReplies = computed(() => activeAgent.value?.settings.quickReplies ?? []);

function toggleQuick(): void {
  if (quickReplies.value.length === 0) return;
  quickOpen.value = !quickOpen.value;
}

/** Тап по стандартному сообщению: сразу в чат, панель сворачивается. */
async function sendQuick(text: string): Promise<void> {
  quickOpen.value = false;
  const value = String(text ?? "").trim();
  if (!value) return;
  // Набранный черновик не теряем: он вернётся в поле после отправки.
  const before = draft.value;
  draft.value = value;
  await send();
  if (!draft.value && before) draft.value = before;
}

/** Клик мимо панели сворачивает её — и на телефоне, и на десктопе. */
function onQuickOutside(event: Event): void {
  if (!quickOpen.value) return;
  const target = event.target as HTMLElement | null;
  if (!target?.closest) return;
  if (target.closest("[data-quick-trigger]") || target.closest(".chat-panel__quick")) return;
  quickOpen.value = false;
}

function onQuickKey(event: KeyboardEvent): void {
  if (event.key === "Escape") quickOpen.value = false;
}
let compactQuery: MediaQueryList | null = null;
/** Клик по кнопке внутри формы (файл, микрофон) не должен закрывать ввод. */
let blurGuardUntil = 0;

function guardBlur(): void {
  blurGuardUntil = Date.now() + 1_500;
}

function syncCompact(matches: boolean): void {
  compact.value = matches;
  if (!matches) composerOpen.value = true;
}

function openComposer(): void {
  if (!compact.value) return;
  quickOpen.value = false;
  composerOpen.value = true;
  void nextTick(() => composerEl.value?.focus());
}

function closeComposer(): void {
  if (!compact.value) return;
  composerOpen.value = false;
}

/** Тап по полотну чата открывает ввод; кнопки и ссылки не перехватываем. */
function onChatTap(event: MouseEvent): void {
  // Открытая панель стандартных сообщений: первый тап по полотну её сворачивает.
  if (quickOpen.value) {
    quickOpen.value = false;
    return;
  }
  if (!compact.value || composerOpen.value) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest("button, a, input, textarea, select, details, summary")) return;
  openComposer();
}

/** Потеря фокуса: закрываем, если фокус ушёл за пределы формы. */
function onComposerBlur(event: FocusEvent): void {
  if (!compact.value) return;
  if (Date.now() < blurGuardUntil) return;
  const next = event.relatedTarget as Node | null;
  if (next && composerForm.value?.contains(next)) return;
  window.setTimeout(() => {
    const active = document.activeElement;
    if (active && composerForm.value?.contains(active)) return;
    closeComposer();
  }, 150);
}

/* ── Сеть и стабильность ──────────────────────────────────────────────── */

const online = ref(typeof navigator === "undefined" ? true : navigator.onLine);

function onOnline(): void {
  online.value = true;
}

function onOffline(): void {
  online.value = false;
}

function onBeforeUnload(event: BeforeUnloadEvent): void {
  if (!busy.value) return;
  event.preventDefault();
  event.returnValue = "";
}

/** Реплика, готовая к отправке: текст + вложения (в памяти, до отправки). */
interface ComposerPayload {
  text: string;
  images: PreparedImage[];
  docs: PreparedDocument[];
}

/** Реплика, ждущая ответа агента. */
interface QueuedMessage extends ComposerPayload {
  id: string;
  /** false — текст уже поправлен в истории, дублировать сообщение не нужно. */
  persist: boolean;
  /** Диалог, в который реплика была написана: очередь переживает переключение. */
  sessionId?: string;
  /** Когда реплику поставили в очередь — по этому времени восстанавливается порядок. */
  at: number;
}

/** Очередь при занятом агенте: можно отправить, изменить или убрать. */
const queue = ref<QueuedMessage[]>([]);

/* ── Очередь в IndexedDB: закрыл вкладку — реплики не пропали ──────────── */

const QUEUE_SAVE_DELAY = 150;
let queueSaveTimer: ReturnType<typeof setTimeout> | null = null;
/** Очередь прочитана из базы; до этого сохранённое не перезаписываем. */
let queueLoaded = false;
/** Сессии прочитаны — можно проверять, живы ли диалоги из очереди. */
let sessionsReady = false;

function scheduleQueueSave(): void {
  if (!queueLoaded) return;
  if (queueSaveTimer) clearTimeout(queueSaveTimer);
  queueSaveTimer = setTimeout(() => {
    queueSaveTimer = null;
    void saveQueue();
  }, QUEUE_SAVE_DELAY);
}

async function saveQueue(): Promise<void> {
  const now = Date.now();
  try {
    await replaceQueued(queue.value.map((item) => toPersisted(item, now)));
  } catch {
    // Хранилище недоступно или переполнено — очередь продолжает жить в памяти.
  }
}

/** Записать очередь немедленно — перед закрытием вкладки. */
function flushQueue(): void {
  if (queueSaveTimer) {
    clearTimeout(queueSaveTimer);
    queueSaveTimer = null;
  }
  void saveQueue();
}

function toQueuedMessage(item: RestoredQueue): QueuedMessage {
  return {
    id: item.id,
    persist: item.persist,
    sessionId: item.sessionId,
    at: item.at,
    text: item.text,
    // Картинки в IndexedDB не сохраняются — см. `lib/queue.ts`.
    images: [],
    docs: item.docs,
  };
}

/**
 * Отправить первую реплику восстановленной очереди — но только когда
 * известно, что её диалог ещё существует.
 */
function drainRestored(): void {
  if (!queueLoaded || !sessionsReady || busy.value) return;
  if (queue.value.length > 0) void drainQueue();
}

/** Поднять очередь из IndexedDB: текст, документы и порядок реплик. */
async function restoreQueue(): Promise<void> {
  let raw: unknown = [];
  try {
    raw = await listQueued();
  } catch {
    raw = [];
  }
  const { items, lostImages, skipped } = readQueued(raw);
  queueLoaded = true;
  if (items.length > 0) {
    queue.value = [...items.map(toQueuedMessage), ...queue.value];
    if (lostImages > 0) notice.value = t("chat.queue.imagesLost");
  }
  // Битые записи или потерянные картинки — привести стор в порядок.
  if (skipped > 0 || lostImages > 0) void saveQueue();
  drainRestored();
}

/** Диалог реплики удалён — в другой её не переносим. */
function pruneQueue(): void {
  if (sessions.value.length === 0) return;
  const alive = new Set(sessions.value.map((s) => s.id));
  const kept = queue.value.filter((item) => !item.sessionId || alive.has(item.sessionId));
  if (kept.length !== queue.value.length) queue.value = kept;
}

watch(queue, scheduleQueueSave, { deep: true });
watch(() => sessions.value.length, pruneQueue);
watch(
  sessionsLoaded,
  (loaded) => {
    if (!loaded) return;
    sessionsReady = true;
    pruneQueue();
    drainRestored();
  },
  { immediate: true },
);
/** «Отправить сейчас»: прерываем текущий ход и шлём эту реплику. */
const immediate = ref<QueuedMessage | null>(null);
/**
 * Реплика, забранная в поле ввода. Из ленты она убрана, отправка создаст
 * новое сообщение, а отмена вернёт её на прежнее место.
 */
interface LiftedMessage {
  message: Message;
  /** Что было в поле до переноса — вернём при отмене. */
  draftBefore: string;
}
const lifted = ref<LiftedMessage | null>(null);
/**
 * Единый блок размышлений хода. Ключ — id ответа (`live` — текущий ход),
 * по умолчанию свёрнут; состояние живёт до перезагрузки.
 */
const thoughtOpen = ref<Record<string, boolean>>({});
const LIVE_KEY = "live";

/** Лента без облачков «Вызовы инструментов»: показываем мысли и ответы. */
const feed = computed<Message[]>(() =>
  withoutToolCalls(messages.value).filter((m) => m.id !== lifted.value?.message.id),
);

/** Все мысли хода, который заканчивается ответом `index`. */
function turnThoughts(index: number): Message[] {
  return collectTurnThoughts(feed.value, index);
}

/** Склеенный текст всех мыслей этого хода. */
function turnThoughtText(index: number): string {
  return thoughtText(turnThoughts(index));
}

function thoughtExpanded(key: string): boolean {
  return thoughtOpen.value[key] === true;
}

/** Раскрыть/свернуть единый блок размышлений хода. */
function toggleThought(key: string): void {
  const next = { ...thoughtOpen.value };
  if (next[key]) delete next[key];
  else next[key] = true;
  thoughtOpen.value = next;
}

/** Мысли текущего (ещё не завершённого) хода — тоже одним блоком. */
const liveThoughts = computed<Message[]>(() => collectTrailingThoughts(feed.value));
const liveThoughtText = computed(() => thoughtText(liveThoughts.value));

/** Подпись роли: имя агента, а у прямого LLM — «модель (LLM)». */
function roleLabel(message: Message): string {
  if (message.role !== "assistant") return t(`chat.role.${message.role}` as never);
  const agent =
    agents.value.find((a) => a.id === activeSession.value?.agentId) ?? activeAgent.value;
  if (!agent) return t("chat.agent");
  if ((agent.protocol ?? "http_json") === "openai") {
    const config = (agent.config ?? {}) as { model?: string };
    const model =
      config.model?.trim() ||
      agent.settings.llmModel?.trim() ||
      agent.name?.trim() ||
      t("chat.agent");
    return `${model} (LLM)`;
  }
  return agent.name?.trim() || t("chat.agent");
}

/** Подпись ассистента для текущего (ещё не записанного) ответа. */
function agentRoleLabel(): string {
  return roleLabel({ role: "assistant" } as Message);
}

const agentSessions = computed<Session[]>(() =>
  sessions.value.filter((s) => !agentId.value || s.agentId === agentId.value),
);

/** Индикаторы хода показываем только в том диалоге, где идёт ответ. */
const liveStreaming = computed(() =>
  streamSessionId.value === activeSessionId.value ? streamingText.value : "",
);
const liveTyping = computed(
  () => typing.value && streamSessionId.value === activeSessionId.value,
);

const filteredSessions = computed<Session[]>(() => {
  const query = historyQuery.value.trim().toLowerCase();
  const list = query
    ? agentSessions.value.filter((s) => s.title.toLowerCase().includes(query))
    : [...agentSessions.value];
  // Закреплённые сверху, дальше — по времени обновления.
  return list.sort((a, b) => {
    const pinA = a.pinned ? 1 : 0;
    const pinB = b.pinned ? 1 : 0;
    if (pinA !== pinB) return pinB - pinA;
    return b.updatedAt - a.updatedAt;
  });
});

/** Полоска недавних диалогов над чатом — как вкладки редактора в Cursor. */
const TABS_STORAGE_KEY = "gena.chat.tabs";
const MAX_TABS = 6;
const tabIds = ref<string[]>(savedTabIds());

function savedTabIds(): string[] {
  try {
    const raw = localStorage.getItem(TABS_STORAGE_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function saveTabIds(): void {
  try {
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(tabIds.value));
  } catch {
    // Приватный режим или отключённое хранилище — полоска живёт до перезагрузки.
  }
}

/** Открыть диалог в полоске: свежие первыми, лишние вытесняются. */
function rememberTab(id: string): void {
  // Открыли закрытую вкладку — она снова видна.
  if (hiddenTabIds.value.includes(id)) {
    hiddenTabIds.value = hiddenTabIds.value.filter((item) => item !== id);
    try {
      localStorage.setItem(TABS_HIDDEN_KEY, JSON.stringify(hiddenTabIds.value));
    } catch {
      // Приватный режим — не критично.
    }
  }
  const next = [id, ...tabIds.value.filter((item) => item !== id)].slice(0, MAX_TABS);
  if (next.join("|") === tabIds.value.join("|")) return;
  tabIds.value = next;
  saveTabIds();
}

/** Закрытые вкладки: диалог живёт в списке, но в полоске его не показываем. */
const TABS_HIDDEN_KEY = "gena.chat.tabs.hidden";
const hiddenTabIds = ref<string[]>(savedHiddenTabIds());

function savedHiddenTabIds(): string[] {
  try {
    const raw = localStorage.getItem(TABS_HIDDEN_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Убрать вкладку из полоски (диалог остаётся в списке и вернётся при открытии). */
function forgetTab(id: string): void {
  tabIds.value = tabIds.value.filter((item) => item !== id);
  if (!hiddenTabIds.value.includes(id)) {
    hiddenTabIds.value = [...hiddenTabIds.value, id];
  }
  saveTabIds();
  try {
    localStorage.setItem(TABS_HIDDEN_KEY, JSON.stringify(hiddenTabIds.value));
  } catch {
    // Приватный режим — скрытие живёт до перезагрузки.
  }
}

/**
 * Полоска вкладок: сверху названия диалогов текущего агента.
 * Порядок — открытые вкладки, активный диалог, дальше свежие по времени.
 * Закрытая вкладка не возвращается сама, пока диалог не откроют снова.
 */
const recentTabs = computed<Session[]>(() => {
  const out: Session[] = [];
  const seen = new Set<string>();
  const hidden = new Set(hiddenTabIds.value);
  const push = (session: Session | undefined): void => {
    if (!session || seen.has(session.id) || hidden.has(session.id)) return;
    seen.add(session.id);
    out.push(session);
  };
  for (const id of tabIds.value) {
    push(agentSessions.value.find((s) => s.id === id));
  }
  push(agentSessions.value.find((s) => s.id === activeSessionId.value));
  const fresh = [...agentSessions.value].sort((a, b) => b.updatedAt - a.updatedAt);
  for (const session of fresh) {
    if (out.length >= MAX_TABS) break;
    push(session);
  }
  return out.slice(0, MAX_TABS);
});

/** Сессии, где агент сейчас отвечает или ждёт своей очереди. */
const busySessionIds = computed<Set<string>>(() => {
  const ids = new Set<string>();
  if (busy.value && streamSessionId.value) ids.add(streamSessionId.value);
  for (const item of queue.value) {
    if (item.sessionId) ids.add(item.sessionId);
  }
  return ids;
});

/** Пользователь у нижней границы диалога — новые сообщения можно подтягивать. */
const stickBottom = ref(true);

function nearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 48;
}

function onMessagesScroll(): void {
  const el = messagesEl.value;
  if (!el) return;
  stickBottom.value = nearBottom(el);
}

/** Полное название диалога для модалки (обрезанный заголовок не прочитать). */
const titleShown = ref("");
/** До какого времени гасим click после долгого тапа. */
let pressGuardUntil = 0;

function showTitle(title: string): void {
  titleShown.value = title || t("chat.newDialog");
  pressGuardUntil = Date.now() + 700;
}

/** true — этот click пришёл сразу после долгого тапа, действие не нужно. */
function clickAfterLongPress(): boolean {
  if (Date.now() >= pressGuardUntil) return false;
  pressGuardUntil = 0;
  return true;
}

function onTitleClick(): void {
  if (clickAfterLongPress()) return;
  startRename();
}

function onTabClick(id: string): void {
  if (clickAfterLongPress()) return;
  void openSession(id);
}

/** Диалог, у которого подтверждаем удаление. */
const confirmDeleteId = ref("");
/** Ответ, который подтверждаем перегенерировать вместе с хвостом. */
const confirmRegenerateId = ref("");
const confirmRegenerateMessage = computed<Message | undefined>(() =>
  messages.value.find((m) => m.id === confirmRegenerateId.value),
);
const confirmDeleteSession = computed<Session | undefined>(() =>
  sessions.value.find((s) => s.id === confirmDeleteId.value),
);

const activeSession = computed<Session | undefined>(() =>
  sessions.value.find((s) => s.id === activeSessionId.value),
);

const activeAgent = computed(() =>
  agents.value.find((a) => a.id === (activeSession.value?.agentId ?? agentId.value)),
);

const callLimit = computed(() => activeAgent.value?.settings.callLimit ?? 0);

const limitLabel = computed(() => {
  if (callLimit.value <= 0) return "";
  return t("chat.usage", { used: usedToday.value, limit: callLimit.value });
});

/**
 * Кто именно печатает: имя агента, иначе нейтральное «Агент».
 * Пометка (LLM) — только для прямого OpenAI-совместимого подключения к модели,
 * а не для агента (Pico WS / HTTP JSON): там работает агент, не «модель».
 */
const isLlmAgent = computed(
  () => (activeAgent.value?.protocol ?? "http_json") === "openai",
);

const typingLabel = computed(() =>
  t(isLlmAgent.value ? "chat.typing.llm" : "chat.typing", {
    name: activeAgent.value?.name?.trim() || t("chat.agent"),
  }),
);

/** Писать можно сразу: сессия создастся при первом «Отправить». */
const canSend = computed(
  () =>
    agents.value.length > 0 &&
    (draft.value.trim().length > 0 ||
      pendingImages.value.length > 0 ||
      pendingDocs.value.length > 0),
);

/** Композер активен, как только есть хотя бы один агент. */
const composerDisabled = computed(() => agents.value.length === 0);

/** Вложения принимает только протокол Pico WS (`payload.media`). */
const supportsImages = computed(
  () => (activeAgent.value?.protocol ?? "http_json") === "pico_ws",
);

const dictationMessage = computed(() => {
  if (!dictationError.value) return "";
  if (
    dictationError.value === "not-allowed" ||
    dictationError.value === "service-not-allowed" ||
    dictationError.value === "audio-capture"
  ) {
    return t("chat.dictateError.notAllowed");
  }
  return t("chat.dictateError.network");
});

async function refreshUsage(): Promise<void> {
  const agent = activeAgent.value;
  if (!agent) {
    usedToday.value = 0;
    return;
  }
  usedToday.value = await getCallCount(agent.id);
}

watch([agentId, activeSessionId, agents], refreshUsage, { immediate: true });

async function scrollToBottom(force = false): Promise<void> {
  if (force) stickBottom.value = true;
  await nextTick();
  const el = messagesEl.value;
  if (!el || !stickBottom.value) return;
  el.scrollTop = el.scrollHeight;
  stickBottom.value = true;
}

/**
 * Догнать низ после смены раскладки: клавиатура, шрифты, картинки,
 * раскрытые шаги, стрим. Планировщик — не чаще одного прохода за кадр,
 * чтобы поток сообщений не запускал десятки циклов за секунду.
 */
let settleQueued = false;

function settleToBottom(): void {
  if (settleQueued) return;
  settleQueued = true;
  window.setTimeout(() => {
    settleQueued = false;
    const el = messagesEl.value;
    if (!el || !stickBottom.value) return;
    el.scrollTop = el.scrollHeight;
    requestAnimationFrame(() => {
      const next = messagesEl.value;
      if (next && stickBottom.value) next.scrollTop = next.scrollHeight;
    });
  }, 16);
}

// Появление сообщений и стрим подтягиваем только если читатель у нижней границы.
watch([messages, streamingText, typing], () => settleToBottom(), { flush: "post" });

/** Растущее поле ввода, как в AiChatPanel (до 4 строк). */
async function autoGrow(): Promise<void> {
  await nextTick();
  const el = composerEl.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 4 * 22)}px`;
}
watch(draft, () => {
  saveDraftSoon();
  void autoGrow();
});

/** «Новый диалог» — просто чистый лист: запись в БД появится после первой отправки. */
function newSession(): void {
  error.value = "";
  notice.value = "";
  stopDictation();
  clearMessages();
  restoreDraft(null);
  historyOpen.value = false;
  void nextTick(() => composerEl.value?.focus());
}

async function openSession(id: string): Promise<void> {
  stopDictation();
  // Диалог всегда открываем с конца: прошлые «листания вверх» не переносим.
  stickBottom.value = true;
  await loadMessages(id);
  restoreDraft(id);
  rememberTab(id);
  historyOpen.value = false;
  // Открываем диалог на последних сообщениях, а не на первых.
  await scrollToBottom(true);
  settleToBottom();
  void resumePending(id);
}

/** Последний агент запоминается, чтобы после перезагрузки открыть его диалог. */
const AGENT_STORAGE_KEY = "gena.chat.agent";

function rememberAgent(id: string): void {
  try {
    localStorage.setItem(AGENT_STORAGE_KEY, id);
  } catch {
    // Приватный режим или отключённое хранилище — не критично.
  }
}

function savedAgentId(): string {
  try {
    return localStorage.getItem(AGENT_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Последняя сессия выбранного агента — по времени обновления. */
async function openLastSession(forAgent = agentId.value): Promise<void> {
  const list = sessions.value.filter((s) => s.agentId === forAgent);
  if (list.length === 0) {
    clearMessages();
    restoreDraft(null);
    return;
  }
  const last = [...list].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  stickBottom.value = true;
  await loadMessages(last.id);
  restoreDraft(last.id);
  // После перезагрузки и смены агента диалог тоже открывается с конца.
  await scrollToBottom(true);
  settleToBottom();
  void resumePending(last.id);
}

/** Диалоги, по которым уже идёт догон, — чтобы не отправить дважды. */
const resuming = new Set<string>();

/** Окно одного пассивного подключения. */
const RESUME_LISTEN_MS = 8_000;
/** Пока сервер подаёт признаки жизни, ждём ответ до этого предела. */
const RESUME_LISTEN_MAX_MS = 3 * 60_000;

/** Итог одного окна прослушивания сессии. */
type ListenOutcome = "answered" | "alive" | "silent";

/**
 * Послушать сессию без отправки.
 *
 * Сервер Pico вещает кадры всем соединениям сессии (`broadcastToSession`),
 * поэтому после закрытия приложения ответ идущего хода можно подобрать,
 * не дублируя реплику в контексте агента.
 */
async function listenTurn(
  session: Session,
  agent: Agent,
  history: Message[],
  windowMs: number,
): Promise<ListenOutcome> {
  const key = await getAgentKey(agent);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), windowMs);
  let heard = false;
  const shown = () => session.id === activeSessionId.value;
  try {
    const response = await listenToAgent(agent, key, {
      sessionId: session.id,
      history,
      signal: controller.signal,
      events: {
        onTyping: (on) => {
          heard = true;
          if (shown()) typing.value = on;
        },
        onDelta: (_id, chunk) => {
          heard = true;
          if (shown()) streamingText.value += chunk;
        },
        onMessage: async (m) => {
          heard = true;
          await appendMessage(session.id, "assistant", m.content, m.kind);
        },
        onUpdate: () => {
          heard = true;
        },
        onNotice: (text) => {
          heard = true;
          if (shown()) showNotice(text);
        },
      },
    });
    const incoming = await collectIncoming(agent, key, response.attachments ?? []);
    // Догоняем ход, начатый до перезапуска: длительность считаем от последней реплики.
    const requestAt = [...history].reverse().find((m) => m.role === "user")?.createdAt;
    const reply = await appendMessage(
      session.id,
      "assistant",
      response.reply,
      undefined,
      incoming,
      requestAt ? Date.now() - requestAt : undefined,
    );
    // Ход на сервере всё-таки состоялся — засчитываем вызов.
    await recordCall(agent.id);
    await refreshUsage();
    if (autoSpeak.value && response.reply.trim()) {
      speak(reply.id, response.reply);
    }
    return "answered";
  } catch {
    return heard ? "alive" : "silent";
  } finally {
    clearTimeout(timer);
    if (shown()) typing.value = false;
    streamingText.value = "";
  }
}

/**
 * Догон незавершённого хода.
 *
 * 1. Сначала слушаем сессию: сервер отдаёт кадры всем соединениям, поэтому
 *    закрытое приложение подбирает ответ без повторной отправки.
 * 2. Ничего не пришло — ход потерян: повторяем исходный текст (как раньше),
 *    но только если ответа после этой реплики в истории ещё нет.
 */
async function resumePending(sessionId: string): Promise<void> {
  if (busy.value || resuming.has(sessionId)) return;
  const pending = pendingFor(sessionId);
  if (!pending || !isPendingFresh(pending, Date.now())) return;
  const session = sessions.value.find((s) => s.id === sessionId);
  const agent = session && agents.value.find((a) => a.id === session.agentId);
  if (!session || !agent?.sealedKey) return;
  const list = await listMessages(sessionId);
  if (!shouldResume(list, pending, Date.now())) {
    forgetPending(sessionId, pending.text);
    return;
  }
  resuming.add(sessionId);
  busy.value = true;
  startTurnClock(pending.at);
  notice.value = t("chat.resumeTurn");
  const history = list.filter(
    (m) => m.role !== "system" && (m.kind === undefined || m.kind === "text"),
  );
  let answered = false;
  let alive = false;
  const deadline = Date.now() + RESUME_LISTEN_MAX_MS;
  try {
    while (!answered && Date.now() < deadline) {
      const outcome = await listenTurn(session, agent, history, RESUME_LISTEN_MS);
      if (outcome === "answered") {
        answered = true;
        break;
      }
      if (outcome === "silent") break;
      alive = true;
    }
  } finally {
    busy.value = false;
    notice.value = "";
    resuming.delete(sessionId);
    stopTurnClock();
  }
  if (answered) {
    forgetPending(sessionId, pending.text);
    return;
  }
  // Ход жив, но ещё думает — повторно не отправляем, догоним в следующий раз.
  if (alive) return;
  await exchange(session, agent, pending.text, [], history);
}

/** Вернулись на вкладку — проверяем, не остался ли незавершённый ход. */
function onVisibility(): void {
  if (document.visibilityState !== "visible") return;
  const id = activeSessionId.value;
  if (id) void resumePending(id);
}

// Агент выбран (вручную или автоматически) — поднимаем его последний диалог.
watch(agentId, async (id) => {
  if (!id) return;
  rememberAgent(id);
  if (activeSession.value?.agentId === id) return;
  await openLastSession(id);
});

// Открытый диалог попадает в полоску вкладок над чатом.
// Смена диалога — читаем с конца, даже если в прошлом листали вверх.
watch(activeSessionId, (id) => {
  stickBottom.value = true;
  if (id) rememberTab(id);
  // Диалог сменился — забранная реплика возвращается в свою ленту.
  if (lifted.value && lifted.value.message.sessionId !== id) lifted.value = null;
  void scrollToBottom(true);
});

// Один агент в списке — выбираем сразу, чтобы можно было писать без настройки.
// Несколько — поднимаем агента, с которым работали в прошлый раз.
watch(
  agents,
  (list) => {
    if (agentId.value || list.length === 0) return;
    const saved = savedAgentId();
    const preferred = list.find((a) => a.id === saved) ?? (list.length === 1 ? list[0] : null);
    if (preferred) agentId.value = preferred.id;
  },
  { immediate: true },
);

/** Забрать содержимое композера в полезную нагрузку (поле очищается). */
function takeComposer(): ComposerPayload | null {
  const text = draft.value.trim();
  const images = pendingImages.value;
  const docs = pendingDocs.value;
  if (!text && images.length === 0 && docs.length === 0) return null;
  draft.value = "";
  pendingImages.value = [];
  pendingDocs.value = [];
  attachError.value = "";
  fileError.value = "";
  // Черновик ушёл в отправку — сохранённую копию убираем, ввод на телефоне прячем.
  writeText(draftKey(activeSessionId.value), "");
  closeComposer();
  void autoGrow();
  return { text, images, docs };
}

/** Заголовок нового диалога — первая строка реплики. */
function sessionTitle(text: string): string {
  const line = (text || "").split("\n")[0].slice(0, 60).trim();
  return line || t("chat.newDialogTitle");
}

/** Создать диалог под реплику и открыть его (экран и так был пустым). */
async function startSession(text: string): Promise<string | undefined> {
  const agent = activeAgent.value;
  if (!agent) return undefined;
  const created = await createSession(agent.id, sessionTitle(text));
  await loadMessages(created.id);
  return created.id;
}

/**
 * Поставить реплику в очередь. Диалог фиксируется в момент постановки:
 * у реплики из «Нового диалога» он создаётся сразу, чтобы позже она
 * не ушла в тот диалог, который окажется открытым.
 */
async function enqueue(
  payload: ComposerPayload,
  persist = true,
  targetSessionId?: string,
): Promise<void> {
  const sessionId =
    targetSessionId ?? activeSessionId.value ?? (await startSession(payload.text));
  queue.value = [
    ...queue.value,
    { id: newId("q"), persist, sessionId, at: Date.now(), ...payload },
  ];
}

/**
 * Клавиши композера: Shift+Enter / Ctrl+Enter / Cmd+Enter — отправить,
 * простой Enter — перенос строки (решение Сергея, 20.11.2026).
 */
function onComposerKey(event: KeyboardEvent): void {
  if (!isSendKey(event)) return;
  event.preventDefault();
  void send();
}

async function send(): Promise<void> {
  error.value = "";
  notice.value = "";
  // Без выбранного агента реплику отправлять некуда — поле не очищаем.
  if (!activeAgent.value) {
    error.value = t("chat.error.chooseAgent");
    return;
  }
  const payload = takeComposer();
  if (!payload) return;
  // Реплика, забранная в поле ввода: её заменит новое сообщение.
  const replace =
    lifted.value && lifted.value.message.sessionId === activeSessionId.value
      ? lifted.value.message
      : undefined;
  // Агент занят — реплика встаёт в очередь, ответа не ждём.
  if (busy.value) {
    await dropLifted();
    await enqueue(payload);
    return;
  }
  try {
    const sent = await dispatch(payload, true, undefined, replace);
    // Не ушло (нет ключа, лимит) — текст возвращаем в поле, реплика ждёт отмены.
    if (!sent && replace) draft.value = replace.content;
  } catch (e) {
    error.value = describeError(e, t);
  }
}

/**
 * Отправить реплику: при необходимости создать сессию, показать сообщение
 * в истории и сходить к агенту. `persist=false` — текст уже в истории,
 * дублировать его не нужно. `replace` — сообщение, забранное в поле ввода:
 * оно уходит из истории, вместо него остаётся новое.
 */
async function dispatch(
  payload: ComposerPayload,
  persist: boolean,
  sessionId?: string,
  replace?: Message,
): Promise<boolean> {
  const text = payload.text;
  // Диалог выбираем строго: у реплики из очереди он свой, и если его уже нет —
  // в чужой открытый диалог реплика не переезжает. Открытый диалог не переключаем.
  let session =
    sessionId === undefined
      ? activeSession.value
      : sessions.value.find((s) => s.id === sessionId);
  const targetAgentId = session?.agentId || agentId.value;
  const agent = agents.value.find((a) => a.id === targetAgentId);
  if (!agent) {
    error.value = t("chat.error.chooseAgent");
    return false;
  }
  if (!agent.sealedKey) {
    error.value = t("chat.error.noKey");
    return false;
  }
  if (!(await withinLimit(agent))) return false;

  if (!session) {
    if (sessionId !== undefined) {
      error.value = t("chat.error.noSession");
      return false;
    }
    const title = sessionTitle(text);
    session = await createSession(agent.id, title);
    // Экран «Нового диалога» остаётся тем же — просто открываем созданную запись.
    if (activeSessionId.value === null) {
      await loadMessages(session.id);
    }
  }
  const attachments: MessageAttachment[] = [
    ...payload.images.map((img) => ({
      kind: "image" as const,
      thumb: img.thumb,
      width: img.width,
      height: img.height,
    })),
    ...payload.docs.map((doc) => ({
      kind: "file" as const,
      name: doc.name,
      bytes: doc.bytes,
    })),
  ];
  // Полный текст документов уходит агенту, в истории остаются подпись и бейджи.
  const outgoing = documentsToMessage(text, payload.docs);
  if (persist) {
    await appendMessage(session.id, "user", text, undefined, attachments);
  }
  // Прежняя реплика из поля ввода больше не нужна: в контекст пойдёт новая.
  if (replace) {
    if (lifted.value?.message.id === replace.id) lifted.value = null;
    await removeMessage(replace);
  }
  const visible = session.id === activeSessionId.value;
  const history = (
    visible ? messages.value : await listMessages(session.id)
  ).filter(
    (m) =>
      m.id !== replace?.id &&
      m.role !== "system" &&
      (m.kind === undefined || m.kind === "text"),
  );
  await exchange(session, agent, outgoing, payload.images.map((img) => img.dataUrl), history);
  return true;
}

/** Отправить реплику из очереди немедленно: текущий ход прерывается. */
function sendQueuedNow(id: string): void {
  const item = queue.value.find((q) => q.id === id);
  if (!item) return;
  queue.value = queue.value.filter((q) => q.id !== id);
  if (!busy.value) {
    void dispatch(item, item.persist, item.sessionId);
    return;
  }
  immediate.value = item;
  stop();
}

function removeQueued(id: string): void {
  queue.value = queue.value.filter((q) => q.id !== id);
}

/** Название другого диалога для реплики в очереди (для текущего — пусто). */
function queueSessionTitle(id?: string): string {
  if (!id || id === activeSessionId.value) return "";
  return sessions.value.find((s) => s.id === id)?.title ?? "";
}

/** Вернуть реплику из очереди в поле ввода — её можно поправить. */
async function editQueued(id: string): Promise<void> {
  const item = queue.value.find((q) => q.id === id);
  if (!item) return;
  removeQueued(id);
  // Правка — в том диалоге, куда реплика адресована.
  if (
    item.sessionId &&
    item.sessionId !== activeSessionId.value &&
    sessions.value.some((s) => s.id === item.sessionId)
  ) {
    await loadMessages(item.sessionId);
  }
  draft.value = item.text;
  pendingImages.value = [...pendingImages.value, ...item.images];
  pendingDocs.value = [...pendingDocs.value, ...item.docs];
  void autoGrow();
  void nextTick(() => composerEl.value?.focus());
}

/** Взять следующую реплику очереди и отправить. */
async function drainQueue(): Promise<void> {
  const head = queue.value[0];
  if (!head) return;
  // Диалог удалили, пока реплика ждала: в другой её не переносим.
  if (head.sessionId && !sessions.value.some((s) => s.id === head.sessionId)) {
    queue.value = queue.value.slice(1);
    error.value = t("chat.error.noSession");
    return;
  }
  queue.value = queue.value.slice(1);
  const sent = await dispatch(head, head.persist, head.sessionId);
  // Не ушло (нет ключа, лимит) — возвращаем в начало, чтобы не потерять.
  if (!sent) queue.value = [head, ...queue.value];
}


/** Проверка дневного лимита вызовов; false — отправлять нельзя. */
async function withinLimit(agent: Agent): Promise<boolean> {
  const limit = agent.settings.callLimit;
  if (limit <= 0) return true;
  if (await canCall(agent.id, limit)) return true;
  error.value = t("chat.error.limitReached", { limit });
  await refreshUsage();
  return false;
}

/** Скачать входящие изображения и превратить их в миниатюры для истории. */
async function collectIncoming(
  agent: Agent,
  key: string,
  list: TransportAttachment[],
): Promise<MessageAttachment[]> {
  if (list.length === 0) return [];
  const result: MessageAttachment[] = [];
  for (const item of list) {
    try {
      const blobUrl = await fetchMediaBlob(agent.address, key, item.url);
      result.push(await attachmentFromBlobUrl(blobUrl, item.url));
    } catch {
      attachError.value = t("chat.attachIncomingError");
    }
  }
  return result;
}

/** Один ход: отправка реплики агенту, приём ответа и его вложений. */
async function exchange(
  session: Session,
  agent: Agent,
  text: string,
  media: string[],
  history: Message[],
): Promise<void> {
  stopDictation();
  lastText.value = text;
  busy.value = true;
  // Часы хода: живой счётчик в облачке ответа и длительность после него.
  const startedAt = Date.now();
  startTurnClock(startedAt);
  // Запоминаем ход: если вкладку закроют до ответа, при следующем открытии догоним.
  rememberPending({ sessionId: session.id, text, at: Date.now() });
  streamSessionId.value = session.id;
  if (session.id === activeSessionId.value) streamingText.value = "";
  let failed = false;
  const controller = new AbortController();
  abortCtrl.value = controller;
  const limit = agent.settings.callLimit;
  // Стрим рисуем только в том диалоге, к которому он относится.
  const shown = () => session.id === activeSessionId.value;
  try {
    const key = await getAgentKey(agent);
    const response = await sendToAgent(
      agent,
      key,
      {
        message: text,
        media,
        sessionId: session.id,
        settings: agent.settings,
        history,
      },
      {
        signal: controller.signal,
        events: {
          onTyping: (on) => {
            if (shown()) typing.value = on;
          },
          onDelta: (_id, chunk) => {
            if (shown()) streamingText.value += chunk;
          },
          onMessage: async (m) => {
            await appendMessage(session.id, "assistant", m.content, m.kind, undefined, Date.now() - startedAt);
          },
          onNotice: (text) => {
            // Служебная плашка сервера: показываем статусом, ответа не ждём молча.
            if (shown()) showNotice(text);
          },
        },
      },
    );
    const incoming = await collectIncoming(agent, key, response.attachments ?? []);
    const reply = await appendMessage(
      session.id,
      "assistant",
      response.reply,
      undefined,
      incoming,
      Date.now() - startedAt,
    );
    // Ответ уже в ленте — живое облачко убираем, чтобы не было двух одинаковых.
    if (shown()) streamingText.value = "";
    await recordCall(agent.id);
    await refreshUsage();
    forgetPending(session.id, text);
    if (autoSpeak.value && response.reply.trim()) {
      speak(reply.id, response.reply);
    }
    if (limit > 0) {
      notice.value = t("chat.remaining", { remaining: Math.max(0, limit - usedToday.value) });
    }
  } catch (e) {
    failed = true;
    // Отмена и смысловые ошибки — не догоняем; сетевые обрывы оставляем до повтора.
    const code = (e as { code?: string }).code;
    const retryable = !controller.signal.aborted &&
      code !== undefined &&
      ["network", "ws_closed", "ws_timeout", "ws_connect"].includes(code);
    if (!retryable) forgetPending(session.id, text);
    error.value = describeError(e, t);
  } finally {
    busy.value = false;
    typing.value = false;
    abortCtrl.value = null;
    streamingText.value = "";
    streamSessionId.value = null;
    stopTurnClock();
    await nextTick();
    if (session.id === activeSessionId.value) composerEl.value?.focus();
    // «Отправить сейчас» важнее ошибки; иначе тянем следующую реплику очереди.
    const next = immediate.value;
    immediate.value = null;
    if (next) {
      void dispatch(next, next.persist, next.sessionId).then((sent) => {
        if (!sent) queue.value = [next, ...queue.value];
      });
    } else if (!failed && queue.value.length > 0) {
      void drainQueue();
    }
  }
}

/**
 * «Повторить ответ»: удаляет ответ и всё, что после него, и отправляет
 * последнюю реплику пользователя заново. Вложения из истории не повторяются —
 * в IndexedDB лежит только миниатюра.
 */
function regenerate(m: Message): void {
  if (busy.value) return;
  const index = messages.value.findIndex((item) => item.id === m.id);
  // Регенерация стирает хвост диалога — спрашиваем, если терять есть что.
  if (index >= 0 && index < messages.value.length - 1) {
    confirmRegenerateId.value = m.id;
    return;
  }
  void runRegenerate(m);
}

async function runRegenerate(m: Message): Promise<void> {
  if (busy.value) return;
  // Повторяем ответ только в том диалоге, которому принадлежит сообщение.
  const session = sessions.value.find((s) => s.id === m.sessionId);
  const agent = agents.value.find((a) => a.id === session?.agentId);
  if (!session || !agent) {
    error.value = t("chat.error.noSession");
    return;
  }
  if (!agent.sealedKey) {
    error.value = t("chat.error.noKey");
    return;
  }

  const index = messages.value.findIndex((item) => item.id === m.id);
  let prompt = "";
  for (let i = index - 1; i >= 0; i--) {
    if (messages.value[i].role === "user") {
      prompt = messages.value[i].content;
      break;
    }
  }
  if (!prompt) {
    error.value = t("chat.error.noPrompt");
    return;
  }

  error.value = "";
  notice.value = "";
  if (!(await withinLimit(agent))) return;
  await deleteMessagesFrom(session.id, m.createdAt);
  const visible = session.id === activeSessionId.value;
  const history = (visible ? messages.value : await listMessages(session.id)).filter(
    (item) => item.role !== "system" && (item.kind === undefined || item.kind === "text"),
  );
  await exchange(session, agent, prompt, [], history);
}

function stop(): void {
  abortCtrl.value?.abort();
}

/**
 * Клик по своей реплике забирает её в поле ввода. Кнопки, картинки и
 * выделенный текст не перехватываем — там свои действия.
 */
/** Markdown реплики → безопасный HTML (кеш внутри lib/markdown). */
function mdHtml(text: string): string {
  return renderMarkdown(text, { copy: t("chat.copyMessage") });
}

/**
 * Делегированный клик по markdown: кнопка «Копировать» в шапке блока кода.
 * Копирование не критично — при отказе браузера молчим, текст на экране есть.
 */
async function onMarkdownClick(event: MouseEvent): Promise<void> {
  const target = event.target as HTMLElement | null;
  const button = target?.closest(".md-code__copy");
  if (!(button instanceof HTMLElement)) return;
  event.preventDefault();
  event.stopPropagation();
  const code = button.closest(".md-code")?.querySelector("code")?.textContent ?? "";
  if (!code) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(code);
    } else {
      copyFallback(code);
    }
    button.classList.add("md-code__copy--done");
    window.setTimeout(() => button.classList.remove("md-code__copy--done"), 1400);
  } catch {
    copyFallback(code);
  }
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
  document.execCommand("copy");
  document.body.removeChild(area);
}

function onMessageClick(event: MouseEvent, m: Message): void {
  if (m.role !== "user" || m.kind) return;
  if (event.button !== 0) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest("button, a, img, summary, details, textarea, input, .md-code, .md-table, pre, code")) return;
  if (window.getSelection()?.toString()) return;
  startEdit(m);
}

/**
 * Забрать свою реплику в поле ввода: из ленты она убирается, отправка создаст
 * новое сообщение, а «Отмена» вернёт её на прежнее место (решение Сергея, 20.11.2026).
 */
function startEdit(m: Message): void {
  if (m.role !== "user" || m.kind) return;
  if (lifted.value?.message.id === m.id) return;
  const previous = lifted.value;
  // Второй перенос без отмены: первая реплика возвращается в ленту.
  const draftBefore = previous ? previous.draftBefore : draft.value;
  lifted.value = { message: m, draftBefore };
  draft.value = m.content;
  error.value = "";
  notice.value = "";
  if (compact.value) composerOpen.value = true;
  void nextTick(() => {
    composerEl.value?.focus();
    void autoGrow();
  });
}

/** Отмена переноса: реплика возвращается в ленту, поле — как было до переноса. */
function cancelLift(): void {
  const current = lifted.value;
  if (!current) return;
  lifted.value = null;
  draft.value = current.draftBefore;
  void autoGrow();
}

/** Реплика ушла заново — прежнее сообщение из истории и контекста убираем. */
async function dropLifted(): Promise<void> {
  const current = lifted.value;
  if (!current) return;
  lifted.value = null;
  await removeMessage(current.message);
}

async function retry(): Promise<void> {
  if (busy.value || !lastText.value) return;
  draft.value = lastText.value;
  await send();
}

function onDictateToggle(): void {
  toggleDictation(draft);
  void autoGrow();
}

async function copyText(id: string, text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    copiedId.value = id;
    window.setTimeout(() => {
      if (copiedId.value === id) copiedId.value = "";
    }, 1500);
  } catch {
    // Буфер обмена недоступен (нет разрешения) — молча пропускаем.
  }
}

async function copyChat(): Promise<void> {
  const lines = messages.value
    .filter((m) => m.kind === undefined || m.kind === "text")
    .map((m) => `${roleLabel(m)}: ${m.content}`);
  if (lines.length === 0) return;
  await copyText("chat", lines.join("\n\n"));
}

function toggleAutoSpeak(): void {
  setAutoSpeak(!autoSpeak.value);
}

function startRename(): void {
  renameDraft.value = activeSession.value?.title ?? "";
  renaming.value = true;
}

async function commitRename(): Promise<void> {
  const session = activeSession.value;
  renaming.value = false;
  if (!session) return;
  await renameSession(session.id, renameDraft.value.trim() || session.title);
}

async function togglePin(session: Session): Promise<void> {
  await pinSession(session.id, !session.pinned);
}

async function duplicate(session: Session): Promise<void> {
  const copy = await duplicateSession(session.id);
  if (copy) await openSession(copy.id);
}

async function removeDialog(sessionId: string): Promise<void> {
  confirmDeleteId.value = "";
  forgetTab(sessionId);
  // Реплики, ждавшие этого диалога, в чужой не переносим.
  queue.value = queue.value.filter((q) => q.sessionId !== sessionId);
  await removeSession(sessionId);
}

function attachMessage(code: string): string {
  if (code === "too_large") return t("chat.attachError.size");
  return t("chat.attachError.type");
}

function documentErrorMessage(error: unknown): string {
  const code = error instanceof DocumentError ? error.code : "read";
  return t(`chat.fileError.${code}` as never);
}

function pickImages(): void {
  fileInput.value?.click();
}

function removeDocument(index: number): void {
  pendingDocs.value = pendingDocs.value.filter((_, i) => i !== index);
  fileError.value = "";
}

async function addFiles(files: File[]): Promise<void> {
  if (files.length === 0) return;
  attachError.value = "";
  fileError.value = "";
  for (const file of files) {
    // Документ превращаем в текст: сервер Pico принимает в media только картинки.
    if (documentKindOf(file)) {
      if (pendingDocs.value.length >= MAX_DOCUMENTS) {
        fileError.value = t("chat.attachError.count");
        break;
      }
      try {
        const prepared = await prepareDocument(file);
        pendingDocs.value = [...pendingDocs.value, prepared];
      } catch (e) {
        fileError.value = documentErrorMessage(e);
      }
      continue;
    }
    if (pendingImages.value.length >= MAX_IMAGES) {
      attachError.value = t("chat.attachError.count");
      break;
    }
    if (!supportsImages.value) {
      attachError.value = t("chat.attachError.type");
      continue;
    }
    try {
      const prepared = await prepareImage(file);
      pendingImages.value = [...pendingImages.value, prepared];
    } catch (e) {
      attachError.value =
        e instanceof ImageError ? attachMessage(e.code) : t("chat.attachError.type");
    }
  }
  await autoGrow();
}

async function onFilesPicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  await addFiles(Array.from(input.files ?? []));
  input.value = "";
}

function removeImage(index: number): void {
  pendingImages.value = pendingImages.value.filter((_, i) => i !== index);
  attachError.value = "";
}

function onPaste(event: ClipboardEvent): void {
  const files = Array.from(event.clipboardData?.files ?? []).filter((f) =>
    f.type.startsWith("image/"),
  );
  if (files.length === 0) return;
  event.preventDefault();
  void addFiles(files);
}

function onDrop(event: DragEvent): void {
  const files = Array.from(event.dataTransfer?.files ?? []).filter((f) =>
    f.type.startsWith("image/"),
  );
  if (files.length === 0) return;
  void addFiles(files);
}

/** Полный размер: из кеша blob-URL либо догружаем с авторизацией. */
async function openAttachment(attachment: MessageAttachment): Promise<void> {
  if (!attachment.thumb && !attachment.refUrl) return;
  const agent = activeAgent.value;
  if (attachment.refUrl && agent?.address) {
    const cached = getCachedMedia(agent.address, attachment.refUrl);
    if (cached) {
      lightbox.value = cached;
      return;
    }
    try {
      const key = await getAgentKey(agent);
      lightbox.value = await fetchMediaBlob(agent.address, key, attachment.refUrl);
      return;
    } catch {
      // Сервер недоступен — остаётся миниатюра.
    }
  }
  lightbox.value = attachment.thumb ?? "";
}

function onLightboxKey(event: KeyboardEvent): void {
  if (event.key === "Escape") lightbox.value = "";
}

watch(lightbox, (open) => {
  if (open) window.addEventListener("keydown", onLightboxKey, { once: true });
});

/** Высота видимой области: на мобильном клавиатура ужимает `visualViewport`. */
function syncViewport(): void {
  const viewport = window.visualViewport;
  const height = viewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty("--app-vvh", `${Math.round(height)}px`);
  void scrollToBottom();
}

onMounted(() => {
  syncViewport();
  // Реплики, ждавшие ответа, поднимаем из IndexedDB — закрытие вкладки их не теряет.
  void restoreQueue();
  // Вернулись на вкладку чата — показываем конец диалога, а не начало.
  void scrollToBottom(true);
  settleToBottom();
  window.visualViewport?.addEventListener("resize", syncViewport);
  window.visualViewport?.addEventListener("scroll", syncViewport);
  window.addEventListener("resize", syncViewport);
  // Телефон: ввод открывается тапом по чату, а не занимает экран постоянно.
  compactQuery = window.matchMedia("(max-width: 640px)");
  syncCompact(compactQuery.matches);
  compactQuery.addEventListener("change", onCompactChange);
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  window.addEventListener("beforeunload", onBeforeUnload);
  window.addEventListener("pagehide", flushDraft);
  window.addEventListener("pagehide", restoreLiftOnHide);
  window.addEventListener("pagehide", flushQueue);
  document.addEventListener("visibilitychange", onVisibility);
  document.addEventListener("pointerdown", onQuickOutside, true);
  window.addEventListener("keydown", onQuickKey);
  // Постоянное хранилище: IndexedDB не должна вычищаться при нехватке места.
  void navigator.storage?.persist?.();
  // Контент вырос (картинки, раскрытые шаги, стрим) — держим низ, если читатель там.
  if (typeof ResizeObserver !== "undefined") {
    threadObserver = new ResizeObserver(() => settleToBottom());
    if (threadEl.value) threadObserver.observe(threadEl.value);
  }
});

function onCompactChange(event: MediaQueryListEvent): void {
  syncCompact(event.matches);
}

onUnmounted(() => {
  stopTurnClock();
  window.visualViewport?.removeEventListener("resize", syncViewport);
  window.visualViewport?.removeEventListener("scroll", syncViewport);
  window.removeEventListener("resize", syncViewport);
  compactQuery?.removeEventListener("change", onCompactChange);
  window.removeEventListener("online", onOnline);
  window.removeEventListener("offline", onOffline);
  window.removeEventListener("beforeunload", onBeforeUnload);
  window.removeEventListener("pagehide", flushDraft);
  window.removeEventListener("pagehide", restoreLiftOnHide);
  window.removeEventListener("pagehide", flushQueue);
  document.removeEventListener("visibilitychange", onVisibility);
  document.removeEventListener("pointerdown", onQuickOutside, true);
  window.removeEventListener("keydown", onQuickKey);
  threadObserver?.disconnect();
  threadObserver = null;
  document.documentElement.style.removeProperty("--app-vvh");
  abortCtrl.value?.abort();
});

function useStarter(n: number): void {
  draft.value = t(`chat.starters.${n}` as never);
  void autoGrow();
  composerEl.value?.focus();
}

function protocolLabel(): string {
  const p = activeAgent.value?.protocol ?? "http_json";
  return t(("connections.protocol." + p) as never);
}

/** Что принимает файловый input: документы + (для Pico) изображения. */
const DOC_ACCEPT = ".pdf,.docx,.xlsx,.txt,.md,.markdown,.csv,.tsv,.json,.log,.yml,.yaml";
const DOC_ACCEPT_IMAGES = `image/*,${DOC_ACCEPT}`;

/** Картинки и документы сообщения — для раздельной отрисовки в истории. */
function imagesOf(message: Message): MessageAttachment[] {
  return (message.attachments ?? []).filter((item) => item.kind === "image" && item.thumb);
}

function filesOf(message: Message): MessageAttachment[] {
  return (message.attachments ?? []).filter((item) => item.kind === "file");
}

function onRateChange(event: Event): void {
  const value = Number((event.target as HTMLSelectElement).value);
  if (Number.isFinite(value)) setSpeechRate(value);
}
</script>

<template>
  <section class="chat-panel">
    <!-- toolbar: заголовок диалога + действия -->
    <div class="chat-panel__toolbar">
      <button
        v-if="!renaming"
        class="chat-panel__title"
        type="button"
        :aria-label="activeSession?.title || t('chat.selectOrCreate')"
        v-longpress="() => showTitle(activeSession?.title || '')"
        @click="onTitleClick"
      >
        <span class="chat-panel__title-text">
          {{ activeSession?.title || t("chat.newDialog") }}
        </span>
      </button>
      <template v-else>
        <input
          v-model="renameDraft"
          class="chat-panel__rename"
          :aria-label="t('chat.renamePlaceholder')"
          @keydown.enter.prevent="commitRename"
          @keydown.esc.prevent="renaming = false"
        />
        <button class="chat-panel__tool is-text" type="button" @click="commitRename">
          {{ t("chat.rename") }}
        </button>
      </template>

      <template v-if="!renaming">
        <button
          type="button"
          class="chat-panel__tool"
          v-tip="t('chat.newDialog')"
          :aria-label="t('chat.newDialog')"
          :disabled="!agentId"
          @click="newSession"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <button
          type="button"
          class="chat-panel__tool"
          v-tip="t('chat.dialogs')"
          :aria-label="t('chat.dialogs')"
          :aria-pressed="historyOpen"
          @click="historyOpen = !historyOpen"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <path d="M3 4v5h5" />
            <path d="M12 8v4l3 2" />
          </svg>
        </button>
        <button
          type="button"
          class="chat-panel__tool"
          v-tip="copiedId === 'chat' ? t('chat.copied') : t('chat.copyMessage')"
          :aria-label="t('chat.copyMessage')"
          :disabled="messages.length === 0"
          @click="copyChat"
        >
          <svg v-if="copiedId === 'chat'" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m5 13 4 4L19 7" />
          </svg>
          <svg v-else viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" />
          </svg>
        </button>
        <button
          v-if="speechAvailable"
          type="button"
          class="chat-panel__tool"
          :class="{ 'is-on': autoSpeak }"
          v-tip="t('chat.autoSpeak')"
          :aria-label="t('chat.autoSpeak')"
          :aria-pressed="autoSpeak"
          @click="toggleAutoSpeak"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M11 5 6 9H3v6h3l5 4z" />
            <path d="M16 9a4 4 0 0 1 0 6" />
            <path d="M19 6a8 8 0 0 1 0 12" />
          </svg>
        </button>
        <select
          v-if="speechAvailable"
          class="chat-panel__rate"
          :value="speechRate"
          v-tip="t('chat.speechRate')"
          :aria-label="t('chat.speechRate')"
          @change="onRateChange"
        >
          <option v-for="rate in SPEECH_RATES" :key="rate" :value="rate">{{ rate }}×</option>
        </select>
      </template>
    </div>

    <div class="chat-panel__agentbar">
      <select v-model="agentId" class="chat-panel__agent" :aria-label="t('chat.agent')">
        <option value="">{{ t("chat.selectAgent") }}</option>
        <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.name }}</option>
      </select>
      <span v-if="activeAgent" class="chat-panel__badge">{{ protocolLabel() }}</span>
      <span v-if="limitLabel" class="chat-panel__usage">{{ limitLabel }}</span>
    </div>

    <nav v-if="recentTabs.length" class="chat-panel__tabs" :aria-label="t('chat.dialogs')">
      <div
        v-for="s in recentTabs"
        :key="s.id"
        class="chat-panel__tab"
        :class="{ 'is-active': s.id === activeSessionId, 'is-busy': busySessionIds.has(s.id) }"
      >
        <button
          type="button"
          class="chat-panel__tab-open"
          :aria-current="s.id === activeSessionId ? 'true' : undefined"
          :title="s.title"
          v-longpress="() => showTitle(s.title)"
          @click="onTabClick(s.id)"
        >
          <span v-if="busySessionIds.has(s.id)" class="chat-panel__busy-dot" aria-hidden="true" />
          <span class="chat-panel__tab-title">{{ s.title }}</span>
        </button>
        <button
          type="button"
          class="chat-panel__tab-close"
          v-tip="t('chat.close')"
          :aria-label="t('chat.close')"
          @click.stop="forgetTab(s.id)"
        >
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </nav>

    <div class="chat-panel__stage">
      <div
        v-if="historyOpen"
        class="chat-panel__sheet-backdrop"
        @click="historyOpen = false"
      />
      <aside
        v-if="historyOpen"
        class="chat-panel__sheet"
        role="dialog"
        aria-modal="true"
        :aria-label="t('chat.dialogs')"
      >
        <div class="chat-panel__sheet-head">
          <input
            v-model="historyQuery"
            class="chat-panel__search"
            type="search"
            :placeholder="t('chat.searchDialogs')"
            :aria-label="t('chat.searchDialogs')"
          />
          <button
            type="button"
            class="chat-panel__tool"
            v-tip="t('chat.close')"
            :aria-label="t('chat.close')"
            @click="historyOpen = false"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <p v-if="filteredSessions.length === 0" class="chat-panel__muted">
          {{ t("chat.selectOrCreate") }}
        </p>
        <ul class="chat-panel__session-list">
          <li
            v-for="s in filteredSessions"
            :key="s.id"
            class="chat-panel__session"
            :class="{
              'is-active': s.id === activeSessionId,
              'is-pinned': s.pinned,
              'is-busy': busySessionIds.has(s.id),
            }"
          >
            <button
              class="chat-panel__session-open"
              type="button"
              v-longpress="() => showTitle(s.title)"
              @click="onTabClick(s.id)"
            >
              <span class="chat-panel__session-title">
                <span
                  v-if="busySessionIds.has(s.id)"
                  class="chat-panel__busy-dot"
                  aria-hidden="true"
                />{{ s.title }}
              </span>
              <span class="chat-panel__session-count">{{ s.messageCount }}</span>
            </button>

            <div class="chat-panel__session-actions">
              <button
                type="button"
                class="chat-panel__action"
                :class="{ 'is-on': s.pinned }"
                v-tip="s.pinned ? t('chat.unpin') : t('chat.pin')"
                :aria-label="s.pinned ? t('chat.unpin') : t('chat.pin')"
                @click="togglePin(s)"
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M12 17v5" />
                  <path d="M9 3h6l-1 6 3 3H7l3-3z" />
                </svg>
              </button>
              <button
                type="button"
                class="chat-panel__action"
                v-tip="t('chat.duplicate')"
                :aria-label="t('chat.duplicate')"
                @click="duplicate(s)"
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="9" y="9" width="11" height="11" rx="2" />
                  <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                </svg>
              </button>
              <button
                type="button"
                class="chat-panel__action is-danger"
                v-tip="t('chat.deleteDialog')"
                :aria-label="t('chat.deleteDialog')"
                @click="confirmDeleteId = s.id"
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
                </svg>
              </button>
            </div>
          </li>
        </ul>
      </aside>

      <div
        ref="messagesEl"
        class="chat-panel__messages"
        role="log"
        aria-live="polite"
        @scroll="onMessagesScroll"
        @click="onChatTap"
        @dragover.prevent
        @drop.prevent="onDrop"
      >
        <div ref="threadEl" class="chat-panel__thread">
        <template v-for="(m, index) in feed" :key="m.id">
          <div
            v-if="m.role === 'assistant' && m.kind !== 'thought' && turnThoughtText(index)"
            class="chat-panel__thought"
            :class="{ 'is-open': thoughtExpanded(m.id) }"
          >
            <button
              type="button"
              class="chat-panel__thought-toggle"
              :aria-expanded="thoughtExpanded(m.id)"
              @click="toggleThought(m.id)"
            >
              <svg
                class="chat-panel__thought-chevron"
                viewBox="0 0 24 24"
                width="13"
                height="13"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
              <span>{{ t("chat.thought") }}</span>
              <span class="chat-panel__thought-count">{{ turnThoughts(index).length }}</span>
            </button>
            <div class="chat-panel__thought-body">
              <div class="chat-panel__thought-inner">{{ turnThoughtText(index) }}</div>
            </div>
          </div>
          <article
            v-if="m.kind !== 'thought'"
            class="chat-panel__message"
            :class="`chat-panel__message--${m.role}`"
            @click="onMessageClick($event, m)"
          >
            <span class="chat-panel__role">
              <span class="chat-panel__time">{{ messageClock(m) }}</span>
              <span class="chat-panel__role-name">{{ roleLabel(m) }}</span>
              <span v-if="messageElapsed(index)" class="chat-panel__elapsed">
                {{ messageElapsed(index) }}
              </span>
            </span>
            <div
              v-if="m.content"
              class="chat-panel__content md"
              @click="onMarkdownClick"
              v-html="mdHtml(m.content)"
            ></div>
            <details v-if="m.edits?.length" class="chat-panel__edits">
              <summary>{{ t("chat.edited") }}</summary>
              <div
                v-for="(v, i) in m.edits"
                :key="i"
                class="chat-panel__content md"
                @click="onMarkdownClick"
                v-html="mdHtml(v)"
              ></div>
            </details>
            <div
              v-if="imagesOf(m).length"
              class="chat-panel__images"
              :data-count="Math.min(imagesOf(m).length, 4)"
            >
              <button
                v-for="(a, i) in imagesOf(m).slice(0, 4)"
                :key="i"
                type="button"
                class="chat-panel__image"
                @click="openAttachment(a)"
              >
                <img :src="a.thumb" alt="" loading="lazy" @load="scrollToBottom()" />
              </button>
            </div>
            <div v-if="filesOf(m).length" class="chat-panel__file-row">
              <span
                v-for="(a, i) in filesOf(m)"
                :key="`file-${i}`"
                class="chat-panel__file-badge"
                :title="a.name"
              >
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                  <path d="M14 3v5h5" />
                </svg>
                <span class="chat-panel__file-name">{{ a.name }}</span>
                <span v-if="a.bytes" class="chat-panel__file-size">{{ formatBytes(a.bytes) }}</span>
              </span>
            </div>
            <div class="chat-panel__message-actions">
              <button
                v-if="m.role === 'user' && !m.kind"
                type="button"
                class="chat-panel__action"
                v-tip="t('chat.liftMessage')"
                :aria-label="t('chat.liftMessage')"
                @click="startEdit(m)"
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M4 20h4l10-10a2.8 2.8 0 1 0-4-4L4 16z" />
                </svg>
              </button>
              <button
                type="button"
                class="chat-panel__action"
                v-tip="copiedId === m.id ? t('chat.copied') : t('chat.copyMessage')"
                :aria-label="t('chat.copyMessage')"
                @click="copyText(m.id, m.content)"
              >
                <svg v-if="copiedId === m.id" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m5 13 4 4L19 7" />
                </svg>
                <svg v-else viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="9" y="9" width="11" height="11" rx="2" />
                  <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                </svg>
              </button>
              <button
                v-if="m.role === 'assistant' && speechAvailable"
                type="button"
                class="chat-panel__action"
                :class="{ 'is-on': speakingId === m.id }"
                v-tip="speakingId === m.id ? t('chat.stopSpeaking') : t('chat.speakReply')"
                :aria-label="speakingId === m.id ? t('chat.stopSpeaking') : t('chat.speakReply')"
                :aria-pressed="speakingId === m.id"
                @click="toggleSpeech(m.id, m.content)"
              >
                <svg v-if="speakingId === m.id" viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
                  <rect x="7" y="7" width="10" height="10" rx="2" />
                </svg>
                <svg v-else viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M11 5 6 9H3v6h3l5 4z" />
                  <path d="M16 9a4 4 0 0 1 0 6" />
                </svg>
              </button>
              <button
                v-if="m.role === 'assistant' && index === feed.length - 1 && !busy"
                type="button"
                class="chat-panel__action"
                v-tip="t('chat.regenerate')"
                :aria-label="t('chat.regenerate')"
                @click="regenerate(m)"
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M20 12a8 8 0 1 1-2.34-5.66" />
                  <path d="M20 4v5h-5" />
                </svg>
              </button>
            </div>
          </article>
        </template>

        <div
          v-if="liveThoughtText"
          class="chat-panel__thought"
          :class="{ 'is-open': thoughtExpanded(LIVE_KEY) }"
        >
          <button
            type="button"
            class="chat-panel__thought-toggle"
            :aria-expanded="thoughtExpanded(LIVE_KEY)"
            @click="toggleThought(LIVE_KEY)"
          >
            <svg
              class="chat-panel__thought-chevron"
              viewBox="0 0 24 24"
              width="13"
              height="13"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
            <span>{{ t("chat.thought") }}</span>
            <span class="chat-panel__thought-count">{{ liveThoughts.length }}</span>
          </button>
          <div class="chat-panel__thought-body">
            <div class="chat-panel__thought-inner">{{ liveThoughtText }}</div>
          </div>
        </div>

        <article
          v-if="liveStreaming"
          class="chat-panel__message chat-panel__message--assistant"
        >
          <span class="chat-panel__role">
            <span v-if="turnStartedAt !== null" class="chat-panel__time">{{
              formatClock(turnStartedAt)
            }}</span>
            <span class="chat-panel__role-name">{{ agentRoleLabel() }}</span>
            <span v-if="liveElapsed" class="chat-panel__elapsed">{{ liveElapsed }}</span>
          </span>
          <div
            class="chat-panel__content md"
            @click="onMarkdownClick"
            v-html="mdHtml(liveStreaming)"
          ></div>
        </article>

        <div
          v-if="messages.length === 0 && !liveTyping && !liveStreaming"
          class="chat-panel__empty"
        >
          <p class="chat-panel__empty-text">{{ t("chat.messagesEmpty") }}</p>
          <p class="chat-panel__empty-title">{{ t("chat.starters.title") }}</p>
          <div class="chat-panel__starters">
            <button
              v-for="n in 3"
              :key="n"
              type="button"
              class="chat-panel__starter"
              :disabled="composerDisabled"
              @click="useStarter(n)"
            >
              {{ t(`chat.starters.${n}` as never) }}
            </button>
          </div>
        </div>
        <p v-if="liveTyping" class="chat-panel__thinking">
          {{ typingLabel }}<span v-if="liveElapsed" class="chat-panel__elapsed"> · {{ liveElapsed }}</span>
        </p>
        </div>
      </div>
    </div>

        <div class="chat-panel__dock" :class="{ 'is-overlay': compact && composerOpen }">
      <p v-if="!online" class="chat-panel__warning" role="alert">{{ t("chat.offline") }}</p>
      <p v-if="dictationListening" class="chat-panel__recording" role="status" aria-live="polite">
        <span class="chat-panel__recording-dot" aria-hidden="true" />
        {{ t("chat.dictateRecording") }}
      </p>
      <p v-if="dictationMessage" class="chat-panel__warning" role="alert">{{ dictationMessage }}</p>
      <p v-if="attachError" class="chat-panel__warning" role="alert">{{ attachError }}</p>
      <p v-if="fileError" class="chat-panel__warning" role="alert">{{ fileError }}</p>
      <p v-if="error" class="chat-panel__warning" role="alert">
        {{ error }}
        <button v-if="lastText" type="button" class="chat-panel__link" @click="retry">
          {{ t("chat.retry") }}
        </button>
      </p>
      <p v-if="notice" class="chat-panel__notice" role="status">{{ notice }}</p>

      <div v-if="queue.length > 0" class="chat-panel__queue">
        <p class="chat-panel__queue-title">
          {{ t("chat.queue.title", { count: queue.length }) }}
        </p>
        <ul class="chat-panel__queue-list">
          <li v-for="q in queue" :key="q.id" class="chat-panel__queue-item">
            <span class="chat-panel__queue-text">
              <template v-if="queueSessionTitle(q.sessionId)"
                >{{ queueSessionTitle(q.sessionId) }}: </template
              >{{ q.text || t("chat.queue.attachment") }}
            </span>
            <span class="chat-panel__queue-actions">
              <button
                type="button"
                class="chat-panel__action"
                v-tip="t('chat.queue.sendNow')"
                :aria-label="t('chat.queue.sendNow')"
                @click="sendQueuedNow(q.id)"
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M12 19V5" />
                  <path d="m6 11 6-6 6 6" />
                </svg>
              </button>
              <button
                type="button"
                class="chat-panel__action"
                v-tip="t('chat.queue.edit')"
                :aria-label="t('chat.queue.edit')"
                @click="editQueued(q.id)"
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M4 20h4l10-10a2.8 2.8 0 1 0-4-4L4 16z" />
                </svg>
              </button>
              <button
                type="button"
                class="chat-panel__action is-danger"
                v-tip="t('chat.queue.remove')"
                :aria-label="t('chat.queue.remove')"
                @click="removeQueued(q.id)"
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </span>
          </li>
        </ul>
      </div>

      <div v-if="compact && !composerOpen" class="chat-panel__open-row">
        <button type="button" class="chat-panel__open" @click="openComposer">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 20h4l10-10a2.8 2.8 0 1 0-4-4L4 16z" />
          </svg>
          <span>{{ t("chat.write") }}</span>
        </button>
        <button
          v-if="quickReplies.length > 0"
          type="button"
          class="chat-panel__quick-trigger"
          data-quick-trigger
          v-tip="t('chat.quickReplies')"
          :aria-label="t('chat.quickReplies')"
          :aria-expanded="quickOpen"
          @click="toggleQuick"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M13 2 5 13.5h6L10 22l9-12h-6z" />
          </svg>
        </button>
      </div>

      <div
        v-if="quickOpen && quickReplies.length > 0"
        class="chat-panel__quick"
        role="group"
        :aria-label="t('chat.quickReplies')"
      >
        <button
          v-for="(text, i) in quickReplies"
          :key="i"
          type="button"
          class="chat-panel__quick-item"
          @click="sendQuick(text)"
        >
          {{ text }}
        </button>
      </div>

      <p v-if="lifted" class="chat-panel__lift" role="status">
        <span>{{ t("chat.lifted") }}</span>
        <button type="button" class="chat-panel__link" @click="cancelLift">
          {{ t("chat.cancel") }}
        </button>
      </p>

      <form
        v-if="!compact || composerOpen"
        ref="composerForm"
        class="chat-panel__composer"
        @submit.prevent="send"
        @focusout="onComposerBlur"
      >
        <div v-if="pendingImages.length > 0 || pendingDocs.length > 0" class="chat-panel__chips">
          <div v-for="(img, i) in pendingImages" :key="i" class="chat-panel__chip">
            <img :src="img.thumb" alt="" />
            <button
              type="button"
              class="chat-panel__chip-remove"
              v-tip="t('chat.attachRemove')"
              :aria-label="t('chat.attachRemove')"
              @click="removeImage(i)"
            >
              ×
            </button>
          </div>
          <div
            v-for="(doc, i) in pendingDocs"
            :key="`doc-${i}`"
            class="chat-panel__chip is-file"
            :title="`${doc.name} · ${formatBytes(doc.bytes)}`"
          >
            <span class="chat-panel__chip-name">{{ doc.name }}</span>
            <span class="chat-panel__chip-size">{{ formatBytes(doc.bytes) }}</span>
            <button
              type="button"
              class="chat-panel__chip-remove"
              v-tip="t('chat.attachRemove')"
              :aria-label="t('chat.attachRemove')"
              @click="removeDocument(i)"
            >
              ×
            </button>
          </div>
        </div>
        <input
          ref="fileInput"
          class="chat-panel__file"
          type="file"
          :accept="supportsImages ? DOC_ACCEPT_IMAGES : DOC_ACCEPT"
          multiple
          @change="onFilesPicked"
        />
        <div class="chat-panel__composer-box" :class="{ 'is-recording': dictationListening }">
          <button
            type="button"
            class="chat-panel__icon-btn"
            v-tip="t('chat.attachFile')"
            :aria-label="t('chat.attachFile')"
            :disabled="composerDisabled"
            @click="guardBlur(); pickImages()"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M20.5 11.5 12 20a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8" />
            </svg>
          </button>
          <textarea
            ref="composerEl"
            v-model="draft"
            class="chat-panel__input"
            rows="1"
            enterkeyhint="enter"
            :placeholder="t('chat.composerPlaceholder')"
            :aria-label="t('chat.composerPlaceholder')"
            :disabled="composerDisabled"
            @keydown="onComposerKey"
            @paste="onPaste"
          />
          <button
            v-if="dictationAvailable"
            type="button"
            class="chat-panel__icon-btn chat-panel__mic"
            :class="{ 'is-listening': dictationListening }"
            v-tip="dictationListening ? t('chat.dictateStop') : t('chat.dictate')"
            :aria-label="dictationListening ? t('chat.dictateStop') : t('chat.dictate')"
            :aria-pressed="dictationListening"
            :disabled="composerDisabled"
            @click="guardBlur(); onDictateToggle()"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0" />
              <path d="M12 18v3" />
            </svg>
          </button>
          <button
            v-if="quickReplies.length > 0"
            type="button"
            class="chat-panel__icon-btn"
            data-quick-trigger
            v-tip="t('chat.quickReplies')"
            :aria-label="t('chat.quickReplies')"
            :aria-expanded="quickOpen"
            :disabled="composerDisabled"
            @click="guardBlur(); toggleQuick()"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M13 2 5 13.5h6L10 22l9-12h-6z" />
            </svg>
          </button>
          <button
            v-if="busy && streamSessionId === activeSessionId"
            type="button"
            class="chat-panel__send is-stop"
            v-tip="t('chat.stop')"
            :aria-label="t('chat.stop')"
            @click="stop"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
              <rect x="7" y="7" width="10" height="10" rx="2" />
            </svg>
          </button>
          <button
            type="button"
            class="chat-panel__send is-primary"
            v-tip="t('chat.send')"
            :aria-label="t('chat.send')"
            :disabled="!canSend"
            @click="send"
          >
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M4 12h15" />
              <path d="m13 6 6 6-6 6" />
            </svg>
          </button>
        </div>
      </form>
    </div>

    <div
      v-if="lightbox"
      class="chat-panel__lightbox"
      role="dialog"
      aria-modal="true"
      @click="lightbox = ''"
    >
      <img :src="lightbox" alt="" />
    </div>

    <TextModal
      :open="Boolean(titleShown)"
      :title="t('chat.sessionName')"
      :text="titleShown"
      :close-label="t('chat.close')"
      @close="titleShown = ''"
    />

    <ConfirmModal
      :open="Boolean(confirmDeleteSession)"
      :title="t('chat.deleteDialog')"
      :message="
        confirmDeleteSession ? t('chat.deleteConfirm', { title: confirmDeleteSession.title }) : ''
      "
      :confirm-label="t('chat.confirm')"
      :cancel-label="t('chat.cancel')"
      @confirm="confirmDeleteSession && removeDialog(confirmDeleteSession.id)"
      @cancel="confirmDeleteId = ''"
    />

    <ConfirmModal
      :open="Boolean(confirmRegenerateMessage)"
      :title="t('chat.regenerate')"
      :message="t('chat.regenerateConfirm')"
      :confirm-label="t('chat.regenerate')"
      :cancel-label="t('chat.cancel')"
      @confirm="
        confirmRegenerateMessage && runRegenerate(confirmRegenerateMessage);
        confirmRegenerateId = ''
      "
      @cancel="confirmRegenerateId = ''"
    />
  </section>
</template>

<style scoped>
/* --- Каркас: как .ai-chat-panel ------------------------------------------- */
.chat-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  height: calc(var(--app-vvh, 100vh) - 132px);
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--panel);
  overflow: hidden;
}

.chat-panel__toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
}

.chat-panel__title {
  flex: 1 1 auto;
  min-width: 0;
  padding: 6px 8px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--text);
  text-align: start;
  cursor: pointer;
}

.chat-panel__title:hover {
  background: var(--panel-2);
}

.chat-panel__title-text {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
  font-size: 0.92rem;
}

.chat-panel__rename {
  flex: 1 1 auto;
  min-width: 0;
  padding: 6px 8px;
}

.chat-panel__tool {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.chat-panel__tool:hover:not(:disabled) {
  color: var(--text);
  background: var(--panel-2);
}

.chat-panel__tool:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.chat-panel__tool.is-on {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}

.chat-panel__tool.is-text {
  width: auto;
  padding: 0 10px;
  font-size: 0.82rem;
}

.chat-panel__agentbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px 6px;
  border-bottom: 1px solid var(--border);
}

.chat-panel__agent {
  width: auto;
  max-width: 60%;
  padding: 4px 8px;
  font-size: 0.82rem;
}

.chat-panel__badge {
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--panel-2);
  color: var(--muted);
  font-size: 11px;
  white-space: nowrap;
}

.chat-panel__usage {
  margin-inline-start: auto;
  color: var(--muted);
  font-size: 0.75rem;
  white-space: nowrap;
}

/* --- Stage и история ------------------------------------------------------ */
.chat-panel__stage {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.chat-panel__sheet-backdrop {
  position: absolute;
  inset: 0;
  z-index: 30;
  background: rgba(0, 0, 0, 0.45);
  animation: gena-fade-in 160ms ease;
}

.chat-panel__sheet {
  position: absolute;
  inset-block: 0;
  inset-inline-end: 0;
  z-index: 31;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: min(86vw, 360px);
  padding: 10px;
  border-inline-start: 1px solid var(--border);
  background: var(--panel);
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.28);
  overflow-y: auto;
  animation: gena-sheet-in 180ms ease;
}

@keyframes gena-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes gena-sheet-in {
  from {
    transform: translateX(100%);
  }
  to {
    transform: translateX(0);
  }
}

.chat-panel__sheet-head {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* --- Полоска недавних диалогов: вкладки как в редакторе (Cursor/VS Code) -- */
.chat-panel__tabs {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  padding: 6px 8px 0;
  margin-bottom: -6px;
  overflow-x: auto;
  scrollbar-width: none;
  background: var(--panel-2);
  position: relative;
}

/* Сплошная линия-разделитель под всей полосой; активная вкладка её перекрывает. */
.chat-panel__tabs::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 1px;
  background: var(--border);
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
  max-width: 13rem;
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

.chat-panel__tab-open {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 11rem;
  padding: 5px 4px 5px 10px;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 0.78rem;
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

/* Агент отвечает (или реплика ждёт очереди) — диалог выделяем жирным. */
.chat-panel__tab.is-busy .chat-panel__tab-title,
.chat-panel__session.is-busy .chat-panel__session-title {
  font-weight: 650;
  color: var(--text);
}

.chat-panel__busy-dot {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  animation: gena-busy-pulse 1.1s ease-in-out infinite;
}

.chat-panel__session-title .chat-panel__busy-dot {
  display: inline-block;
  margin-inline-end: 6px;
  vertical-align: middle;
}

@keyframes gena-busy-pulse {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.8);
  }
  50% {
    opacity: 1;
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .chat-panel__busy-dot {
    animation: none;
    opacity: 1;
  }
}

.chat-panel__search {
  padding: 6px 10px;
}

.chat-panel__session-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.chat-panel__session {
  display: flex;
  align-items: center;
  gap: 2px;
}

.chat-panel__session-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 2px;
  opacity: 0;
  transition: opacity 120ms ease;
}

.chat-panel__session:hover .chat-panel__session-actions,
.chat-panel__session:focus-within .chat-panel__session-actions,
.chat-panel__session.is-active .chat-panel__session-actions {
  opacity: 1;
}

@media (hover: none) {
  .chat-panel__session-actions {
    opacity: 1;
  }
}

.chat-panel__session.is-pinned .chat-panel__session-title {
  font-weight: 600;
}

.chat-panel__session .chat-panel__action {
  width: 28px;
  height: 28px;
}

.chat-panel__action.is-danger:hover {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 14%, transparent);
}

.chat-panel__link.is-danger {
  color: var(--danger);
}

.chat-panel__session-open {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--text);
  text-align: start;
  cursor: pointer;
}

.chat-panel__session-open:hover {
  background: var(--panel-2);
}

.chat-panel__session.is-active .chat-panel__session-open {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
}

.chat-panel__session-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.86rem;
}

.chat-panel__session-count {
  flex: 0 0 auto;
  color: var(--muted);
  font-size: 0.72rem;
}

.chat-panel__messages {
  flex: 1 1 auto;
  min-height: 0;
  padding: 8px 8px 0;
  overflow-y: auto;
}

/* Обёртка нужна ResizeObserver: рост контента возвращает читателя к низу. */
.chat-panel__thread {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 100%;
}

/* --- Пузыри: как .ai-chat-panel__message --------------------------------- */
.chat-panel__message {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: min(100%, 36rem);
  padding: 4px 10px;
  border-radius: 14px;
}

.chat-panel__message--user {
  align-self: flex-end;
  margin-inline-start: 2rem;
  background: color-mix(in srgb, var(--accent) 14%, var(--panel));
  border-end-end-radius: 4px;
}

.chat-panel__message--assistant {
  align-self: flex-start;
  margin-inline-start: 0.75rem;
  margin-inline-end: 1.25rem;
  padding-inline: 0;
  background: transparent;
}

.chat-panel__role {
  color: var(--muted);
  font-size: 0.68rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  display: inline-flex;
  align-items: baseline;
  gap: 0.35rem;
}

/* Время появления сообщения — мелко, в начале строки автора. */
.chat-panel__time {
  font-size: 0.64rem;
  font-variant-numeric: tabular-nums;
  opacity: 0.75;
}

/* Длительность ответа: «42 с», «1 мин 05 с». */
.chat-panel__elapsed {
  font-size: 0.62rem;
  letter-spacing: 0;
  text-transform: none;
  font-variant-numeric: tabular-nums;
  opacity: 0.85;
  white-space: nowrap;
}

.chat-panel__content {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.45;
  font-size: 0.88rem;
}

/* ---------- Markdown в ленте (lib/markdown.ts) ---------- */

.chat-panel__content.md {
  white-space: normal;
}

.chat-panel__content.md > :first-child {
  margin-top: 0;
}

.chat-panel__content.md > :last-child {
  margin-bottom: 0;
}

.md p,
.md ul,
.md ol,
.md blockquote,
.md .md-code,
.md .md-table {
  margin: 0 0 0.5em;
}

.md h1,
.md h2,
.md h3,
.md h4,
.md h5,
.md h6 {
  margin: 0.6em 0 0.35em;
  line-height: 1.3;
  font-weight: 600;
}

.md h1 {
  font-size: 1.05rem;
}

.md h2 {
  font-size: 1rem;
}

.md h3,
.md h4,
.md h5,
.md h6 {
  font-size: 0.92rem;
}

.md ul,
.md ol {
  padding-left: 1.15em;
}

.md li {
  margin: 0.15em 0;
}

.md blockquote {
  padding-left: 0.6em;
  border-left: 2px solid var(--border);
  color: var(--muted);
}

.md hr {
  margin: 0.6em 0;
  border: 0;
  border-top: 1px solid var(--border);
}

.md code {
  padding: 0.05em 0.3em;
  border-radius: 5px;
  background: var(--panel-2);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.82em;
}

.md a {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
  overflow-wrap: anywhere;
}

/* Блок кода: отдельная панель, шапка с языком и кнопкой «Копировать». */
.md-code {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-2);
  overflow: hidden;
}

.md-code__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 1px 4px 1px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 0.66rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted);
}

.md-code__copy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.md-code__copy:hover,
.md-code__copy:focus-visible {
  background: rgba(127, 127, 127, 0.18);
  color: var(--text);
}

.md-code__copy::before {
  content: "";
  width: 14px;
  height: 14px;
  background: currentColor;
  -webkit-mask: var(--md-icon-copy) center / contain no-repeat;
  mask: var(--md-icon-copy) center / contain no-repeat;
}

.md-code__copy--done {
  color: var(--ok);
}

.md-code__copy--done::before {
  -webkit-mask-image: var(--md-icon-check);
  mask-image: var(--md-icon-check);
}

.md-code__pre {
  margin: 0;
  padding: 8px 10px;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  -webkit-overflow-scrolling: touch;
  font-size: 0.78rem;
  line-height: 1.5;
}

.md-code__pre code {
  padding: 0;
  background: none;
  border-radius: 0;
  white-space: pre;
}

/* Таблица: горизонтальный скролл внутри своего блока. */
.md-table {
  overflow-x: auto;
  overscroll-behavior-x: contain;
  -webkit-overflow-scrolling: touch;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.md-table table {
  border-collapse: collapse;
  width: max-content;
  min-width: 100%;
  font-size: 0.8rem;
}

.md-table th,
.md-table td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  white-space: nowrap;
}

.md-table thead th {
  background: var(--panel-2);
  font-weight: 600;
}

.md-table tr:last-child td {
  border-bottom: 0;
}

.chat-panel__message-actions {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 120ms ease;
}

.chat-panel__message:hover .chat-panel__message-actions,
.chat-panel__message:focus-within .chat-panel__message-actions,
.chat-panel__message:last-child .chat-panel__message-actions {
  opacity: 1;
}

.chat-panel__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.chat-panel__action:hover {
  color: var(--text);
  background: var(--panel-2);
}

.chat-panel__action.is-on {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 16%, transparent);
}

/* Кнопка шагов хода: иконка-шеврон + счётчик шагов. */
.chat-panel__action--steps {
  width: auto;
  gap: 2px;
  padding: 0 5px;
}

.chat-panel__action-count {
  font-size: 0.68rem;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

/* --- Размышления: строка с шевроном, текст приглушённый (как в Cursor) --- */
.chat-panel__thought {
  align-self: stretch;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.chat-panel__thought-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 6px 2px 2px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  font-size: 0.76rem;
  cursor: pointer;
}

.chat-panel__thought-toggle:hover {
  color: var(--text);
  background: color-mix(in srgb, var(--panel-2) 65%, transparent);
}

.chat-panel__thought-chevron {
  flex: 0 0 auto;
  transition: transform 0.15s ease;
}

.chat-panel__thought.is-open .chat-panel__thought-chevron {
  transform: rotate(90deg);
}

.chat-panel__thought-body {
  display: grid;
  grid-template-rows: 0fr;
  align-self: stretch;
  transition: grid-template-rows 0.18s ease;
}

.chat-panel__thought.is-open .chat-panel__thought-body {
  grid-template-rows: 1fr;
}

.chat-panel__thought-inner {
  overflow: hidden;
  min-height: 0;
  margin-left: 7px;
  padding-left: 10px;
  border-left: 2px solid color-mix(in srgb, var(--border) 80%, transparent);
  color: var(--muted);
  font-size: 0.8rem;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.chat-panel__thought.is-open .chat-panel__thought-inner {
  padding-top: 4px;
  padding-bottom: 2px;
}

.chat-panel__muted {
  margin: 0;
  color: var(--muted);
  font-size: 0.86rem;
}

.chat-panel__thinking {
  margin: 0;
  color: var(--muted);
  font-size: 0.8rem;
  font-style: italic;
}

/* --- Dock: композер как в AiChatPanel ------------------------------------ */
.chat-panel__dock {
  position: relative;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: auto;
  padding: 0 8px 8px;
}

/* Мягкая маска: сообщения «уходят» под композер, а не обрываются. */
.chat-panel__dock::before {
  content: "";
  position: absolute;
  inset-inline: 0;
  top: -18px;
  height: 18px;
  background: linear-gradient(to top, var(--panel), transparent);
  pointer-events: none;
}

.chat-panel__composer {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
}

.chat-panel__composer-box {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  padding: 6px 6px 6px 10px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--panel-2);
}

.chat-panel__composer-box:focus-within {
  border-color: var(--accent);
}

.chat-panel__composer-box.is-recording {
  border-color: var(--danger);
}

.chat-panel__input {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 32px;
  max-height: 88px;
  padding: 6px 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--text);
  font-size: 0.9rem;
  line-height: 1.4;
  resize: none;
  overflow-y: auto;
}

.chat-panel__input:focus {
  outline: none;
}

/* Подсказка должна укладываться в одну строку на телефоне. */
.chat-panel__input::placeholder {
  font-size: 0.72rem;
  letter-spacing: -0.02em;
  white-space: nowrap;
  text-overflow: ellipsis;
}

@media (max-width: 480px) {
  .chat-panel__input::placeholder {
    font-size: 0.62rem;
  }
}

.chat-panel__icon-btn {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.chat-panel__icon-btn:hover:not(:disabled) {
  color: var(--text);
  background: color-mix(in srgb, var(--text) 8%, transparent);
}

.chat-panel__icon-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.chat-panel__mic.is-listening,
.chat-panel__mic.is-listening:hover:not(:disabled) {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 16%, transparent);
  animation: gena-mic-pulse 1.4s ease-in-out infinite;
}

@keyframes gena-mic-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--danger) 45%, transparent);
  }
  50% {
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--danger) 0%, transparent);
  }
}

.chat-panel__send {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--panel);
  color: var(--text);
  cursor: pointer;
}

.chat-panel__send.is-primary {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
}

.chat-panel__send:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* Стоп рядом с отправкой: маленький, чтобы не спорить с основной кнопкой. */
.chat-panel__send.is-stop {
  width: 30px;
  height: 30px;
  align-self: center;
  border-color: color-mix(in srgb, var(--danger) 45%, var(--border));
  border-radius: 9px;
  color: var(--danger);
}

.chat-panel__recording {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 0;
  padding: 6px 12px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--danger) 12%, var(--panel));
  color: var(--danger);
  font-size: 0.78rem;
  font-weight: 600;
}

.chat-panel__recording-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--danger);
  animation: gena-recording-dot 1.2s ease-in-out infinite;
}

@keyframes gena-recording-dot {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.25;
  }
}

.chat-panel__warning {
  margin: 0;
  color: var(--danger);
  font-size: 0.78rem;
}

.chat-panel__notice {
  margin: 0;
  color: var(--ok);
  font-size: 0.75rem;
}

.chat-panel__link {
  padding: 0 4px;
  border: 0;
  background: none;
  color: var(--accent);
  font-size: inherit;
  text-decoration: underline;
  cursor: pointer;
}

/* --- Очередь реплик ------------------------------------------------------ */
.chat-panel__queue {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border: 1px dashed var(--border);
  border-radius: 12px;
  background: color-mix(in srgb, var(--panel-2) 70%, transparent);
}

.chat-panel__queue-title {
  margin: 0;
  color: var(--muted);
  font-size: 0.7rem;
}

.chat-panel__queue-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.chat-panel__queue-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.chat-panel__queue-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.78rem;
  color: var(--text);
}

.chat-panel__queue-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 2px;
}

/* --- Реплика, забранная в поле ввода ------------------------------------ */
.chat-panel__lift {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 0;
  padding: 4px 8px;
  border: 1px dashed var(--accent);
  border-radius: 10px;
  color: var(--muted);
  font-size: 0.72rem;
}

.chat-panel__edits {
  margin-top: 2px;
  color: var(--muted);
  font-size: 0.72rem;
}

.chat-panel__edits summary {
  cursor: pointer;
}

.chat-panel__edits .chat-panel__content {
  margin-top: 4px;
  padding-inline-start: 8px;
  border-inline-start: 2px solid var(--border);
  opacity: 0.75;
  font-size: 0.8rem;
}

@media (max-width: 720px) {
  .chat-panel {
    height: calc(var(--app-vvh, 100vh) - 118px);
    border-radius: 0;
    border-inline: 0;
  }
  .chat-panel__messages {
    padding: 6px 6px 0;
  }
  .chat-panel__message-actions {
    opacity: 1;
  }
  .chat-panel__tool {
    width: 36px;
    height: 36px;
  }
  .chat-panel__dock {
    padding-bottom: calc(8px + env(safe-area-inset-bottom));
  }
  .chat-panel__message--user {
    margin-inline-start: 1rem;
  }
}

/* --- Пустое состояние: стартеры ------------------------------------------ */
.chat-panel__empty {
  margin: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 16px;
  text-align: center;
}

.chat-panel__empty-text,
.chat-panel__empty-title {
  margin: 0;
  color: var(--muted);
  font-size: 0.84rem;
}

.chat-panel__empty-title {
  font-size: 0.72rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.chat-panel__starters {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
}

.chat-panel__starter {
  padding: 6px 10px;
  border-radius: 999px;
  background: var(--panel-2);
  color: var(--text);
  font-size: 0.8rem;
}

.chat-panel__starter:hover:not(:disabled) {
  border-color: var(--accent);
}

/* --- Вложения ------------------------------------------------------------ */
.chat-panel__file {
  display: none;
}

.chat-panel__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chat-panel__chip {
  position: relative;
  width: 56px;
  height: 56px;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--panel-2);
}

.chat-panel__chip img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* Документ в чипе: имя + размер вместо миниатюры. */
.chat-panel__chip.is-file {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  width: auto;
  min-width: 120px;
  max-width: 200px;
  height: 56px;
  padding: 6px 26px 6px 10px;
}

.chat-panel__chip-name {
  display: block;
  overflow: hidden;
  color: var(--text);
  font-size: 0.78rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-panel__chip-size {
  color: var(--muted);
  font-size: 0.72rem;
}

.chat-panel__chip-remove {
  position: absolute;
  top: 2px;
  inset-inline-end: 2px;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(13, 17, 23, 0.72);
  color: #fff;
  font-size: 13px;
  line-height: 1;
}

.chat-panel__images {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  max-width: 20rem;
}

.chat-panel__images[data-count="1"] {
  grid-template-columns: minmax(0, 1fr);
}

.chat-panel__image {
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--panel-2);
  aspect-ratio: 4 / 3;
}

.chat-panel__image img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.chat-panel__lightbox {
  position: fixed;
  inset: 0;
  z-index: 9998;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.82);
}

.chat-panel__lightbox img {
  max-width: 100%;
  max-height: 100%;
  border-radius: 8px;
  object-fit: contain;
}
/* Скорость озвучки: компактный select рядом с кнопкой динамика. */
.chat-panel__rate {
  flex: 0 0 auto;
  width: auto;
  height: 32px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--panel);
  color: var(--text);
  font-size: 0.78rem;
}

/* Документы в истории сообщений: бейджи под текстом. */
.chat-panel__file-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.chat-panel__file-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--panel-2);
  color: var(--muted);
  font-size: 0.75rem;
}

.chat-panel__file-name {
  overflow: hidden;
  max-width: 160px;
  color: var(--text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-panel__file-size {
  flex: 0 0 auto;
  opacity: 0.8;
}

/* --- Единый блок размышлений: счётчик мыслей ---------------------------- */
.chat-panel__thought-count {
  min-width: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--panel-2);
  color: var(--muted);
  font-size: 0.7rem;
  line-height: 18px;
  text-align: center;
}

/* --- Телефон: ввод по тапу, поверх ленты -------------------------------- */
.chat-panel__open-row {
  display: flex;
  gap: 6px;
  align-items: stretch;
}

.chat-panel__open-row .chat-panel__open {
  flex: 1 1 auto;
}

.chat-panel__quick-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  padding: 0 13px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--panel-2);
  color: var(--accent);
  cursor: pointer;
}

.chat-panel__quick-trigger:hover {
  color: var(--text);
  border-color: var(--accent);
}

.chat-panel__quick {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: calc(100% + 6px);
  z-index: 40;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: min(50vh, 340px);
  overflow-y: auto;
  padding: 8px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: 0 -10px 28px rgba(0, 0, 0, 0.22);
}

.chat-panel__quick-item {
  flex: 0 0 auto;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--panel-2);
  color: var(--text);
  font: inherit;
  text-align: start;
  cursor: pointer;
}

.chat-panel__quick-item:hover {
  border-color: var(--accent);
}

.chat-panel__open {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 11px 14px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--panel-2);
  color: var(--muted);
  font: inherit;
  cursor: pointer;
}

.chat-panel__open:hover {
  color: var(--text);
}

.chat-panel__dock.is-overlay {
  position: absolute;
  inset-inline: 0;
  bottom: 0;
  z-index: 30;
  padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px));
  background: var(--panel);
  border-top: 1px solid var(--border);
  box-shadow: 0 -10px 28px rgba(0, 0, 0, 0.22);
}

.chat-panel__dock.is-overlay::before {
  display: none;
}
</style>
