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
  assignSessionAgent,
  stampUnownedReplies,
  clearMessages,
  createSession,
  deleteMessagesFrom,
  duplicateSession,
  editMessage,
  getAgentKey,
  loadMessages,
  messages,
  pinSession,
  removeMessage,
  removeMessageByServerId,
  removeSession,
  renameSession,
  sessions,
  sessionsLoaded,
  setSessionTokenMode,
  setSessionTokenView,
  ackTokenSend,
} from "@/lib/store";
import { newId } from "@/lib/id";
import { shouldOpenLastSession } from "@/lib/session-open";
import { composerFieldHeight, isSendKey } from "@/lib/composer";
import AppFooter from "@/components/AppFooter.vue";
import TokenSheet from "@/components/TokenSheet.vue";
import SessionTabs from "@/components/SessionTabs.vue";
import { listenToAgent, sendToAgent, type TransportAttachment } from "@/lib/agent-client";
import { cancelAgentTurn } from "@/lib/agent-client";
import { describeError } from "@/lib/errors";
import { renderMarkdown } from "@/lib/markdown";
import { toCsv, toTsv, xlsxBlob } from "@/lib/table-file";
import { splitContent } from "@/lib/ui-blocks";
import { hasOpenSlot } from "@/lib/model-fallback";
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
import { capabilitiesOf } from "@/lib/transports";
import { isBusySession as isSessionBusy, liveSessionCount, pickRunnable } from "@/lib/turn-queue";
import { useSessionTabs } from "@/composables/useSessionTabs";
import { useLiveTurns } from "@/composables/useLiveTurns";
import { useAgentFilter } from "@/composables/useAgentFilter";
import {
  AGENT_STORAGE_KEY,
  FEED_WINDOW,
  MAX_PENDING,
  PENDING_KEY,
  draftKey,
  forgetPending,
  parsePending,
  pendingFor,
  readStoredText,
  rememberPending,
  writeStoredText,
} from "@/turn/draft";
import { idleTurn, stepTurn } from "@/turn/machine";
import {
  loadTokens,
  replaceValues,
  restoreValues,
  saveToken,
  tokenEntries,
  tokenLookup,
  tokensLoaded,
  TokenError,
  type TokenEntry,
} from "@/lib/tokens/registry";
import { formatToken, parseTokens } from "@/lib/tokens/format";
import { findSelectionEntry, replaceRange, suggestTokenNames } from "@/lib/tokens/selection";
import {
  findOccurrences,
  replaceAllInText,
  replaceSpan,
  stepIndex,
} from "@/lib/tokens/occurrences";
import { tokenModeActive } from "@/lib/tokens/mode-intent";
import { loadMorph } from "@/lib/tokens/morph/service";
import { forAgent, historyForAgent, tokensReady } from "@/lib/tokens/outgoing";
import { insertTokenAt } from "@/lib/tokens/insert";
import {
  applyTokenPick,
  filterTokenNames,
  findTokenTrigger,
  type TokenTrigger,
} from "@/lib/tokens/trigger";
import ConfirmModal from "@/components/ConfirmModal.vue";
import TextModal from "@/components/TextModal.vue";
import { agentId } from "@/lib/active-agent";

const { t } = useLocale();
const draft = ref("");
const error = ref("");
const notice = ref("");
/**
 * Ошибки фоновых диалогов: показываем, только когда человек откроет этот диалог,
 * иначе чужой сбой всплывал бы поверх открытого чата.
 */
const sessionErrors = ref<Record<string, string>>({});

function setSessionError(sessionId: string, text: string): void {
  if (!text) {
    if (!sessionErrors.value[sessionId]) return;
    const rest = { ...sessionErrors.value };
    delete rest[sessionId];
    sessionErrors.value = rest;
    return;
  }
  sessionErrors.value = { ...sessionErrors.value, [sessionId]: text };
}

/** Ошибка открытого диалога: общая (действие пользователя) или своя у сессии. */
const errorText = computed(
  () => error.value || sessionErrors.value[activeSessionId.value ?? ""] || "",
);
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
/**
 * Режим токенов: справочник подстановок работает всегда, а флаг диалога
 * решает только одно — в каком виде история лежит на диске.
 *
 * Настоящие значения не уходят агенту ни при каком флаге: отправляемый
 * текст и контекст проходят через `lib/tokens/outgoing.ts`.
 */

/**
 * Намерение «новый диалог в режиме токенов»: записи ещё нет, а выключатель
 * уже должен работать. Переносится в сессию при её создании.
 */
const pendingTokenMode = ref(false);

/** Диалог в режиме токенов: флаг записи или намерение для нового диалога. */
function isTokenSession(session?: Session | null): boolean {
  return tokenModeActive(session, pendingTokenMode.value);
}

/** Справочник нужен движку подстановки: читаем его до первого решения. */
async function ensureTokens(): Promise<void> {
  if (tokensLoaded.value) return;
  await loadTokens().catch(() => undefined);
}

/** Текст для истории: в режиме токенов значения записываются токенами. */
function storedContent(text: string, session?: Session | null): string {
  return isTokenSession(session) ? forAgent(text) : text;
}

/** Что человек видит в ленте: значения (по умолчанию) или токены. */
function displayContent(text: string): string {
  return viewValues.value ? restoreValues(text) : text;
}

/**
 * Перевести диалог в режим токенов или вернуть к обычному тексту.
 *
 * Работает и на экране «Новый диалог»: записи ещё нет — включаем намерение,
 * оно применится к сессии при первой отправке. Пустой справочник не помеха:
 * первый токен человек как раз и делает из выделения в поле ввода.
 */
/** Переключение уже идёт: второй клик не должен запускать его заново. */
const tokenSwitching = ref(false);

async function toggleTokenMode(): Promise<void> {
  if (busy.value || tokenSwitching.value) return;
  error.value = "";
  tokenSheetOpen.value = false;
  const session = activeSession.value;
  const next = !isTokenSession(session);
  tokenSwitching.value = true;
  // Справочник нужен только для текста уведомления («пуст» или нет).
  // Грузим его параллельно: флаг режима ставится сразу, без ожидания IndexedDB.
  const tokensReady = ensureTokens();
  const noticeFor = () =>
    showNotice(
      next
        ? t(tokenEntries.value.length > 0 ? "chat.tokenModeOn" : "chat.tokenModeNoEntries")
        : t("chat.tokenModeOff"),
    );
  try {
    if (!session) {
      pendingTokenMode.value = next;
      await tokensReady;
      noticeFor();
      return;
    }
    const switching = setSessionTokenMode(session.id, next);
    await tokensReady;
    const result = await switching;
    noticeFor();
    // История переписана — перечитываем, чтобы лента совпала с базой.
    if (result.rewritten > 0) await loadMessages(session.id);
  } catch (e) {
    error.value = describeError(e, t);
  } finally {
    tokenSwitching.value = false;
  }
}

/** Выезжающая таблица соответствий «токен ↔ значение» — главный экран режима. */
const tokenSheetOpen = ref(false);

/** Панель «Вставить токен»: имена из справочника. */
const tokenPickOpen = ref(false);
const tokenNames = computed(() =>
  tokenEntries.value.map((item) => item.name).sort((a, b) => a.localeCompare(b, "ru")),
);

/** Открытый фрагмент `⟦…` перед кареткой: подсказка по мере набора. */
const tokenTrigger = ref<TokenTrigger | null>(null);

/** Имена в панели подсказки: от триггера — отфильтрованные, от кнопки — все. */
const tokenPickNames = computed(() => {
  const trigger = tokenTrigger.value;
  if (trigger) {
    return isTokenSession(activeSession.value) ? filterTokenNames(tokenNames.value, trigger.query) : [];
  }
  return tokenPickOpen.value ? tokenNames.value : [];
});

const tokenPickVisible = computed(
  () => tokenPickNames.value.length > 0 && (tokenTrigger.value !== null || tokenPickOpen.value),
);

function toggleTokenPick(): void {
  // Пустой справочник — не тупик: сразу открываем таблицу соответствий,
  // где запись добавляется вручную, а не показываем «сначала заполните».
  if (tokenEntries.value.length === 0) {
    tokenPickOpen.value = false;
    tokenSheetOpen.value = true;
    return;
  }
  tokenPickOpen.value = !tokenPickOpen.value;
}

/** Вставить канон `⟦имя⟧` в позицию курсора и вернуть фокус в поле. */
function insertTokenName(name: string): void {
  const el = composerEl.value;
  const caret = el && el.selectionStart !== null ? el.selectionStart : draft.value.length;
  const trigger = tokenTrigger.value;
  const result = trigger
    ? applyTokenPick(draft.value, caret, name, trigger)
    : insertTokenAt(draft.value, caret, name);
  draft.value = result.text;
  tokenTrigger.value = null;
  tokenPickOpen.value = false;
  if (compact.value && !composerOpen.value) composerOpen.value = true;
  void nextTick(() => {
    const area = composerEl.value;
    if (!area) return;
    area.focus();
    area.setSelectionRange(result.caret, result.caret);
  });
}

/** Ввод в поле: обновляем подсказку токенов (⟦…). Справочник работает в любом диалоге. */
function onComposerInput(event: Event): void {
  // Выделение сдвинулось — плашка под полем больше не про этот фрагмент.
  if (selectionRange.value) clearSelection();
  if (occurrenceTotal.value > 0) finishOccurrences();
  const el = event.target as HTMLTextAreaElement | null;
  const caret = el && el.selectionStart !== null ? el.selectionStart : draft.value.length;
  tokenTrigger.value = findTokenTrigger(draft.value, caret);
  if (tokenTrigger.value) void ensureTokens();
}

/** Открыть выезжающую таблицу соответствий прямо в чате. */
function openDictionary(): void {
  tokenPickOpen.value = false;
  tokenSheetOpen.value = true;
}

/** Полный справочник — перенос файлом и морфологический словарь (дополнение). */
function openTokensTab(): void {
  emit("open-tokens");
}

/* ── Подтверждение отправки и действия с выделением ───────────────────── */

/** Коды ошибок справочника → ключи текстов. */
const TOKEN_ERROR_KEYS: Record<string, string> = {
  name_required: "tokens.error.name_required",
  name_invalid: "tokens.error.name_invalid",
  name_duplicate: "tokens.error.name_duplicate",
  value_required: "tokens.error.value_required",
  save_failed: "tokens.error.save_failed",
};

function describeTokenError(code: string): string {
  const key = TOKEN_ERROR_KEYS[code];
  return key ? t(key as Parameters<typeof t>[0]) : t("tokens.error.save_failed");
}

/** Первая отправка в токеновом диалоге ждёт подтверждения. */
const pendingTokenSend = ref(false);
/** Выделенный фрагмент поля ввода — плашка живёт под полем, не у выделения. */
const selectionRange = ref<{ start: number; end: number; text: string } | null>(null);
/** Имя нового токена, когда выделенного фрагмента ещё нет в справочнике. */
const selectionName = ref("");
/** Фрагмент, для которого имя уже предложено: повторные события `select`
 *  не должны затирать то, что человек успел ввести. */
const selectionSource = ref("");
/** Подтверждение замены известного значения: карточку имени не показываем. */
const selectionConfirm = ref<TokenEntry | null>(null);

/** Запись справочника, совпадающая с текущим выделением. */
const selectionMatch = computed(() => {
  const range = selectionRange.value;
  if (!range) return null;
  return findSelectionEntry(range.text, tokenEntries.value);
});

function clearSelection(): void {
  selectionRange.value = null;
  selectionName.value = "";
  selectionSource.value = "";
  selectionConfirm.value = null;
}

/** Варианты имени-подсказки: то, что предлагает словарь выделения. */
const selectionSuggestions = computed(() => {
  const range = selectionRange.value;
  if (!range || selectionMatch.value) return [];
  const taken = selectionName.value.trim().toLocaleLowerCase();
  return suggestTokenNames(range.text, tokenNames.value, 4)
    .filter((name) => name.toLocaleLowerCase() !== taken)
    .slice(0, 3);
});

/**
 * Выделение изменилось: показать плашку под полем.
 *
 * Плашка не зависит от режима токенов: справочник — свойство устройства,
 * а не диалога. Иначе в обычном диалоге выделение «ничего не делает».
 */
function onComposerSelect(): void {
  // Вхождение выбрано программно стрелкой плашки — серию не сбрасываем.
  if (occurrencePicking) return;
  const el = composerEl.value;
  if (!el) {
    clearSelection();
    finishOccurrences();
    return;
  }
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  if (end <= start) {
    // Выделения нет — закрываем серию только если плашка и была про серию.
    if (occurrenceTotal.value === 0) clearSelection();
    return;
  }
  const text = draft.value.slice(start, end).trim();
  if (text.length < 2) {
    clearSelection();
    return;
  }
  void ensureTokens();
  const known = findSelectionEntry(text, tokenEntries.value);
  selectionRange.value = { start, end, text };
  if (known) {
    selectionName.value = known.name;
  } else if (selectionSource.value !== text || !selectionName.value.trim()) {
    // Новый фрагмент — предлагаем имя сами: «цена 1 200 ₽» → «цена»,
    // без букв — «имя» (и «имя2», если занято).
    selectionName.value = suggestTokenNames(text, tokenNames.value, 1)[0] ?? "";
  }
  selectionSource.value = text;
  selectionConfirm.value = null;

  // Вхождения того же фрагмента: поле ввода и сообщения открытого диалога.
  // Только счёт — текущее вхождение не подсвечиваем, выделение сделал человек.
  if (occurrenceNeedle.value && occurrenceNeedle.value !== text) finishOccurrences();
  occurrenceNeedle.value = text;
  occurrenceToken.value = known?.name ?? "";
  refreshOccurrences(0, false);
  // Плашка заменяет выделенное вхождение, а не первое в тексте.
  const at = occurrenceList.value.findIndex(
    (item) => item.scope === "draft" && item.start >= start && item.end <= end,
  );
  if (at >= 0) occurrenceIndex.value = at;
}

/**
 * Выделение с задержкой: на телефоне маркеры выделения двигаются после
 * pointerup/touchend, а событие select приходит не во всех WebView.
 */
let selectionTimer = 0;

function onComposerSelectSoon(): void {
  window.clearTimeout(selectionTimer);
  selectionTimer = window.setTimeout(onComposerSelect, 120);
}

/** Перетаскивание выделения мышью/пальцем внутри поля. */
function onDocSelectionChange(): void {
  const el = composerEl.value;
  if (!el || document.activeElement !== el) return;
  onComposerSelectSoon();
}

/* ── Вхождения значения: стрелки и «Заменить все» ─────────────────────── */

/** Куда указывает текущее вхождение: поле ввода или сообщение ленты. */
interface OccurrenceTarget {
  scope: "draft" | "message";
  messageId?: string;
  role?: Message["role"];
  start: number;
  end: number;
}

const occurrenceList = ref<OccurrenceTarget[]>([]);
const occurrenceIndex = ref(0);
/** Значение, по которому идёт серия замен, и токен, которым заменяем. */
const occurrenceNeedle = ref("");
const occurrenceToken = ref("");
/** Сколько вхождений заменить нельзя: внутри токена, внутри слова, вне режима. */
const occurrenceBlocked = ref({ token: 0, word: 0, mode: 0 });
/** Подсвеченное сообщение ленты — чтобы было видно, какое вхождение меняем. */
const occurrenceMessageId = ref("");
/** Выбор вхождения сделан программно: событие `select` не должно сбрасывать серию. */
let occurrencePicking = false;

const occurrenceTotal = computed(() => occurrenceList.value.length);
const occurrenceCurrent = computed(() => occurrenceList.value[occurrenceIndex.value] ?? null);

/** Плашка под полем: выделение в поле или идущая серия замен. */
const selectionBanner = computed(() => {
  if (pendingTokenSend.value) return false;
  return Boolean(selectionRange.value) || occurrenceTotal.value > 0;
});

const bannerFragment = computed(() => selectionRange.value?.text ?? occurrenceNeedle.value);
const bannerToken = computed(() => selectionMatch.value?.name ?? occurrenceToken.value);

/** Где находится текущее вхождение — подпись в плашке. */
const bannerScope = computed(() => {
  const target = occurrenceCurrent.value;
  if (!target || target.scope !== "message") return "";
  return target.role === "user" ? t("chat.tokens.inMyMessage") : t("chat.tokens.inAgentMessage");
});

/** Что именно не заменяется и почему. */
const occurrenceBlockedHint = computed(() => {
  const blocked = occurrenceBlocked.value;
  const parts: string[] = [];
  if (blocked.mode > 0) parts.push(t("chat.tokens.agentNeedsMode"));
  if (blocked.token > 0) parts.push(t("chat.tokens.blockedToken", { count: blocked.token }));
  if (blocked.word > 0) parts.push(t("chat.tokens.blockedWord", { count: blocked.word }));
  return parts.join(" · ");
});

/** Все вхождения значения: поле ввода и текстовые сообщения открытого диалога. */
function collectOccurrences(needle: string): {
  items: OccurrenceTarget[];
  blocked: { token: number; word: number; mode: number };
} {
  const items: OccurrenceTarget[] = [];
  const blocked = { token: 0, word: 0, mode: 0 };
  for (const hit of findOccurrences(draft.value, needle, { includeBlocked: true })) {
    if (hit.blocked) blocked[hit.blocked] += 1;
    else items.push({ scope: "draft", start: hit.start, end: hit.end });
  }
  // В ответах агента заменяем только в режиме токенов: иначе в ленте
  // появился бы ⟦токен⟧, который диалог не расшифровывает.
  const tokenSession = isTokenSession(activeSession.value);
  for (const message of messages.value) {
    if ((message.kind && message.kind !== "text") || !message.content) continue;
    for (const hit of findOccurrences(message.content, needle, { includeBlocked: true })) {
      if (hit.blocked) blocked[hit.blocked] += 1;
      else if (!tokenSession) blocked.mode += 1;
      else
        items.push({
          scope: "message",
          messageId: message.id,
          role: message.role,
          start: hit.start,
          end: hit.end,
        });
    }
  }
  return { items, blocked };
}

/** Показать текущее вхождение в поле ввода или прокрутить к сообщению. */
async function highlightOccurrence(): Promise<void> {
  const target = occurrenceCurrent.value;
  if (!target) return;
  if (target.scope === "draft") {
    occurrenceMessageId.value = "";
    const area = composerEl.value;
    if (!area) return;
    occurrencePicking = true;
    area.focus();
    area.setSelectionRange(target.start, target.end);
    window.setTimeout(() => {
      occurrencePicking = false;
    }, 260);
    return;
  }
  occurrenceMessageId.value = target.messageId ?? "";
  await nextTick();
  const host = document.querySelector(
    `.chat-panel__message[data-message-id="${target.messageId}"]`,
  );
  host?.scrollIntoView({ block: "center", behavior: "smooth" });
}

/** Пересчитать вхождения. `highlight` — показать текущее (после замены). */
function refreshOccurrences(index = 0, highlight = true): number {
  const needle = occurrenceNeedle.value;
  if (!needle) return 0;
  const { items, blocked } = collectOccurrences(needle);
  occurrenceList.value = items;
  occurrenceBlocked.value = blocked;
  occurrenceIndex.value = items.length === 0 ? 0 : Math.min(Math.max(index, 0), items.length - 1);
  if (items.length === 0) {
    occurrenceMessageId.value = "";
    return 0;
  }
  if (highlight) void highlightOccurrence();
  return items.length;
}

/** Серия началась: первое вхождение уже заменено токеном. */
function startOccurrences(needle: string, name: string): void {
  occurrenceNeedle.value = needle;
  occurrenceToken.value = name;
  refreshOccurrences(0);
}

/** Закрыть серию: плашка остаётся только у выделения. */
function finishOccurrences(): void {
  occurrenceList.value = [];
  occurrenceIndex.value = 0;
  occurrenceNeedle.value = "";
  occurrenceToken.value = "";
  occurrenceBlocked.value = { token: 0, word: 0, mode: 0 };
  occurrenceMessageId.value = "";
}

function dismissSelection(): void {
  clearSelection();
  finishOccurrences();
}

// Сменили диалог — серия замен относилась к прежнему.
watch(activeSessionId, () => finishOccurrences());

/** Стрелки: по кругу от второго вхождения до последнего. */
function stepOccurrence(delta: number): void {
  if (occurrenceTotal.value === 0) return;
  occurrenceIndex.value = stepIndex(occurrenceIndex.value, occurrenceTotal.value, delta);
  void highlightOccurrence();
}

/** Серия начата кнопкой «Заменить все» — берём значение из выделения. */
function ensureOccurrenceState(): boolean {
  if (occurrenceNeedle.value && occurrenceToken.value) return true;
  const range = selectionRange.value;
  // Только существующая запись: подставлять ⟦имя⟧, которого нет в справочнике,
  // нельзя — агент получил бы токен без значения.
  const name = selectionMatch.value?.name ?? "";
  if (!range || !name) return false;
  occurrenceNeedle.value = range.text;
  occurrenceToken.value = name;
  if (occurrenceList.value.length === 0) refreshOccurrences(0, false);
  return true;
}

/** Заменить текущее вхождение и перейти к следующему. */
async function replaceCurrentOccurrence(): Promise<void> {
  if (!ensureOccurrenceState()) return;
  const target = occurrenceCurrent.value;
  const name = occurrenceToken.value;
  if (!target || !name) return;
  const insert = formatToken(name);
  if (target.scope === "draft") {
    draft.value = replaceSpan(draft.value, target.start, target.end, insert);
    clearSelection();
    await nextTick();
    if (refreshOccurrences(occurrenceIndex.value) === 0) finishOccurrences();
    return;
  }
  const message = messages.value.find((item) => item.id === target.messageId);
  if (!message) return;
  const updated = await editMessage(
    message.id,
    replaceSpan(message.content, target.start, target.end, insert),
  );
  if (!updated) return;
  if (refreshOccurrences(occurrenceIndex.value) === 0) finishOccurrences();
}

/** «Заменить все N»: поле ввода и ответы агента разом. */
async function replaceAllOccurrences(): Promise<void> {
  if (!ensureOccurrenceState()) return;
  const name = occurrenceToken.value;
  const needle = occurrenceNeedle.value;
  if (!name || !needle) return;
  const insert = formatToken(name);
  let replaced = 0;
  if (isTokenSession(activeSession.value)) {
    for (const message of messages.value) {
      if ((message.kind && message.kind !== "text") || !message.content) continue;
      const result = replaceAllInText(message.content, needle, insert);
      if (result.replaced === 0) continue;
      if (await editMessage(message.id, result.text)) replaced += result.replaced;
    }
  }
  const inDraft = replaceAllInText(draft.value, needle, insert);
  if (inDraft.replaced > 0) {
    draft.value = inDraft.text;
    replaced += inDraft.replaced;
  }
  clearSelection();
  finishOccurrences();
  if (replaced > 0) notice.value = t("chat.tokens.replaced", { count: replaced });
}

/** Клик по «галочке»: одно вхождение — как раньше, несколько — сразу меняем. */
function onReplaceClick(): void {
  if (occurrenceTotal.value > 1) void replaceCurrentOccurrence();
  else if (selectionMatch.value) askSelectionReplace();
  else void replaceCurrentOccurrence();
}

/** Вставить токен вместо выделенного фрагмента. */
async function applySelectionToken(name: string): Promise<void> {
  const range = selectionRange.value;
  if (!range) return;
  const needle = range.text;
  const result = replaceRange(draft.value, range.start, range.end, formatToken(name));
  draft.value = result.text;
  clearSelection();
  await nextTick();
  const area = composerEl.value;
  if (area) {
    area.focus();
    area.setSelectionRange(result.caret, result.caret);
  }
  // Остальные вхождения того же значения — сразу под рукой.
  startOccurrences(needle, name);
}

/** Известное значение: подтверждение есть, карточки с именем нет. */
function askSelectionReplace(): void {
  const match = selectionMatch.value;
  if (match) selectionConfirm.value = match;
}

function confirmSelectionReplace(): void {
  const entry = selectionConfirm.value;
  clearSelection();
  if (entry) void applySelectionToken(entry.name);
}

/** Неизвестный фрагмент: имя вводится прямо в плашке под полем. */
async function createTokenFromSelection(): Promise<void> {
  const range = selectionRange.value;
  const name = selectionName.value.trim();
  if (!range || !name) return;
  error.value = "";
  try {
    await saveToken({ name, value: range.text });
    await applySelectionToken(name);
    notice.value = t("chat.tokens.created");
  } catch (e) {
    error.value = e instanceof TokenError ? describeTokenError(e.code) : t("tokens.error.save_failed");
  }
}

/** Подтверждение первой отправки: дальше диалог помнит решение. */
async function confirmTokenSend(): Promise<void> {
  const id = activeSessionId.value;
  pendingTokenSend.value = false;
  if (id) await ackTokenSend(id);
  await sendNow();
}

function cancelTokenSend(): void {
  pendingTokenSend.value = false;
}

async function leaveTokenMode(): Promise<void> {
  tokenPickOpen.value = false;
  await toggleTokenMode();
}

/** Сколько вызовов сделано сегодня у выбранного агента. */
const usedToday = ref(0);
/** Последний отправленный текст — для кнопки «Повторить». */
const lastText = ref("");
/**
 * Показывать в ленте значения вместо токенов. Решение хранится на диалог:
 * в одном удобно читать значения, в другом — видеть ровно то, что у агента.
 */
const viewValues = computed<boolean>({
  get: () => {
    const session = sessions.value.find((item) => item.id === activeSessionId.value);
    return session?.tokenView !== "tokens";
  },
  set: (value) => {
    const id = activeSessionId.value;
    const session = sessions.value.find((item) => item.id === id);
    if (!id || !isTokenSession(session)) return;
    void setSessionTokenView(id, value ? "values" : "tokens");
  },
});
/* ── Ходы по диалогам: у каждой сессии свой ход и своя очередь ─────────── */

const {
  turns,
  now: clockNow,
  turnOf,
  open: openTurn,
  patch: patchTurn,
  close: closeTurn,
  appendStream,
  dispose: disposeTurns,
} = useLiveTurns();

/** Подписи единиц длительности из словаря. */
const durationUnits = computed(() => ({
  h: t("chat.time.h"),
  m: t("chat.time.m"),
  s: t("chat.time.s"),
}));

/** Ход открытого диалога — по нему строится строка статуса и стоп-кнопка. */
const activeTurn = computed(() => turnOf(activeSessionId.value));
const busy = computed(() => activeTurn.value !== undefined);

/** Сколько идёт ответ открытого диалога — «7 с». */
const liveElapsed = computed(() => {
  const started = activeTurn.value?.startedAt;
  if (started === undefined) return "";
  return formatDuration(Math.max(0, clockNow.value - started), durationUnits.value);
});

/** Время работы агента в этом диалоге: плашка над полем ввода. */
const turnElapsed = computed(() => (busy.value ? liveElapsed.value : ""));

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
let composerObserver: ResizeObserver | null = null;
let composerWidth = 0;
/** Поле ввода — чтобы вернуть фокус после отправки. */
/** Переход в справочник из панели режима токенов. */
const emit = defineEmits<{ (e: "open-tokens"): void }>();

const composerEl = ref<HTMLTextAreaElement | null>(null);
/** Сколько строк сейчас в поле: от этого зависит кнопка «Очистить» и высота. */
const composerLines = ref(1);
const composerMultiline = computed(() => composerLines.value > 1);
/** Ручная высота поля ввода в пикселях; null — авторасчёт по строкам. */
const composerManualHeight = ref<number | null>(null);
/** Границы ручного растяжения: одна строка и примерно 14 строк. */
const COMPOSER_MANUAL_MIN = 38;
const COMPOSER_MANUAL_MAX = 360;
/** Шит истории диалогов (как в AiChatPanel). */
const historyOpen = ref(false);
const historyQuery = ref("");
/** Режим переименования диалога в шапке. */
const renaming = ref(false);
const renameDraft = ref("");
const renameEl = ref<HTMLInputElement | null>(null);
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

function readText(key: string): string {
  return readStoredText(window.localStorage, key);
}

function writeText(key: string, value: string): void {
  writeStoredText(window.localStorage, key, value);
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
  return parsePending(readText(PENDING_KEY));
}

function writePending(list: PendingTurn[]): void {
  writeText(PENDING_KEY, JSON.stringify(list.slice(-MAX_PENDING)));
}

function rememberPendingTurn(turn: PendingTurn): void {
  writePending(rememberPending(readPending(), turn));
}

function forgetPendingTurn(sessionId: string, text: string): void {
  writePending(forgetPending(readPending(), sessionId, text));
}

/** Последний незавершённый ход этого диалога. */
function pendingTurnFor(sessionId: string): PendingTurn | null {
  return pendingFor(readPending(), sessionId);
}

/* ── Окно ввода на телефоне: по тапу, поверх чата ─────────────────────── */

const compact = ref(
  typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches,
);
const composerOpen = ref(!compact.value);
const composerForm = ref<HTMLFormElement | null>(null);

/* Низ ленты не должен уезжать под ввод: на телефоне док ложится поверх чата. */
const dockEl = ref<HTMLElement | null>(null);
/** Сколько места занял док-оверлей (px) — на столько поднимаем низ ленты. */
const dockSpace = ref(0);
let dockObserver: ResizeObserver | null = null;

function syncDockSpace(): void {
  const el = dockEl.value;
  // На телефоне док лежит поверх ленты в обоих состояниях: с вводом и без него.
  const floating = compact.value;
  const next = floating && el ? Math.round(el.getBoundingClientRect().height) + 8 : 0;
  if (next === dockSpace.value) return;
  dockSpace.value = next;
  settleToBottom();
}

watch([compact, composerOpen], () => void nextTick(syncDockSpace), { flush: "post" });
/* На телефоне поле ввода монтируется заново при каждом открытии — высоту
   восстанавливаем по тексту, иначе длинный черновик окажется в одну строку. */
watch(composerOpen, () => void autoGrow(), { flush: "post" });

/* ── Стандартные сообщения: кнопки над композером ─────────────────────── */

/** Панель открыта (одна на док и на композер). */
const quickOpen = ref(false);
/** Меню выбора агента у скрепки. */
const agentMenuOpen = ref(false);
/** Стандартные сообщения выбранного агента — нормализованы при чтении/сохранении. */
const quickReplies = computed(() => activeAgent.value?.settings.quickReplies ?? []);
/** «Стоп» в доке виден, только когда работает открытый диалог. */
const canStopHere = computed(() => busy.value);

function toggleQuick(): void {
  if (quickReplies.value.length === 0) return;
  quickOpen.value = !quickOpen.value;
  if (quickOpen.value) agentMenuOpen.value = false;
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
  const target = event.target as HTMLElement | null;
  if (!target?.closest) return;
  if (quickOpen.value) {
    if (!target.closest("[data-quick-trigger]") && !target.closest(".chat-panel__quick")) {
      quickOpen.value = false;
    }
  }
  if (tokenPickOpen.value) {
    if (!target.closest("[data-token-trigger]") && !target.closest(".chat-panel__token-pick")) {
      tokenPickOpen.value = false;
    }
  }
  if (agentMenuOpen.value) {
    if (!target.closest("[data-agent-trigger]") && !target.closest(".chat-panel__agent-menu")) {
      agentMenuOpen.value = false;
    }
  }
}

function onQuickKey(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  quickOpen.value = false;
  agentMenuOpen.value = false;
}

function toggleAgentMenu(): void {
  agentMenuOpen.value = !agentMenuOpen.value;
  if (agentMenuOpen.value) quickOpen.value = false;
}

/** Агент сессии: следующие ответы и стандартные сообщения — от него. */
async function chooseAgent(id: string): Promise<void> {
  agentMenuOpen.value = false;
  const session = activeSession.value;
  if (session && session.agentId !== id) {
    const previous = session.agentId;
    await stampUnownedReplies(session.id, previous);
    await assignSessionAgent(session.id, id);
  }
  agentId.value = id;
}
let compactQuery: MediaQueryList | null = null;
/** Клик по кнопке внутри формы (файл, микрофон) не должен закрывать ввод. */
let blurGuardUntil = 0;

function guardBlur(): void {
  blurGuardUntil = Date.now() + 1_500;
}

function syncCompact(matches: boolean): void {
  compact.value = matches;
  // На телефоне поле прячется, но пустой диалог без него бесполезен.
  if (!matches || (sessionsLoaded.value && !activeSessionId.value)) composerOpen.value = true;
}

// Новый диалог (в том числе после закрытия последнего) — поле ввода сразу.
// Ждём загрузки диалогов: до неё «нет открытого» ничего не значит.
watch([activeSessionId, sessionsLoaded], ([id, loaded]) => {
  if (!compact.value || !loaded) return;
  if (!id) composerOpen.value = true;
});

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

/** Тап по полотну чата открывает ввод, повторный — прячет его. Кнопки и ссылки не перехватываем. */
function onChatTap(event: MouseEvent): void {
  // Открытая панель стандартных сообщений: первый тап по полотну её сворачивает.
  if (quickOpen.value) {
    quickOpen.value = false;
    return;
  }
  if (!compact.value) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest("button, a, input, textarea, select, details, summary")) return;
  if (composerOpen.value) {
    closeComposer();
    return;
  }
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
  // Сеть вернулась — сразу пробуем подобрать ответ брошенного хода.
  const id = activeSessionId.value;
  if (id) void resumePending(id);
}

function onOffline(): void {
  online.value = false;
}

function onBeforeUnload(event: BeforeUnloadEvent): void {
  if (liveTurnCount() === 0) return;
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
  if (!queueLoaded || !sessionsReady) return;
  if (queue.value.length > 0) void pumpQueue();
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
/**
 * «Отправить сейчас» по диалогам: прерываем ход этого диалога и шлём реплику.
 * Ключ — id диалога, чтобы заявки из разных диалогов не перепутались.
 */
const immediate = ref<Record<string, QueuedMessage>>({});

/** Сколько ходов одновременно: больше — очередь ждёт, чтобы не забить сеть. */
const MAX_LIVE_TURNS = 3;
/** Диалоги, где отправка уже началась, но ход ещё не открыт. */
const dispatching = ref<string[]>([]);

/** Ход в диалоге идёт или вот-вот начнётся. */
function isBusySession(sessionId: string | null | undefined): boolean {
  return isSessionBusy(turns.value, dispatching.value, sessionId);
}

/** Сколько диалогов работает прямо сейчас. */
function liveTurnCount(): number {
  return liveSessionCount(turns.value, dispatching.value);
}

function markDispatching(sessionId: string, on: boolean): void {
  const has = dispatching.value.includes(sessionId);
  if (on && !has) dispatching.value = [...dispatching.value, sessionId];
  if (!on && has) dispatching.value = dispatching.value.filter((id) => id !== sessionId);
}

/** Отправить реплику из очереди в её диалог, не дожидаясь чужих ходов. */
function startQueued(item: QueuedMessage): void {
  const key = item.sessionId ?? activeSessionId.value ?? "";
  if (key) markDispatching(key, true);
  let sent = false;
  void dispatch(item, item.persist, item.sessionId)
    .then((ok) => {
      sent = ok;
      // Не ушло (нет ключа, лимит) — возвращаем в начало, чтобы не потерять.
      if (!ok) queue.value = [item, ...queue.value];
    })
    .catch((e) => {
      error.value = describeError(e, t);
    })
    .finally(() => {
      if (key) markDispatching(key, false);
      // Упавшую реплику сразу не переспрашиваем: иначе бесконечный круг
      // «взяли из очереди → не ушло → положили обратно».
      void pumpQueue(sent ? undefined : key);
    });
}

/**
 * Раздать очередь по диалогам: каждая сессия берёт свою первую реплику,
 * но не больше `MAX_LIVE_TURNS` одновременных ходов.
 */
async function pumpQueue(skipSessionId?: string): Promise<void> {
  for (;;) {
    const item = pickRunnable(queue.value, {
      isBusy: isBusySession,
      live: liveTurnCount(),
      limit: MAX_LIVE_TURNS,
      skipSessionId,
    });
    if (!item) return;
    // Диалог удалили, пока реплика ждала: в другой её не переносим.
    if (item.sessionId && !sessions.value.some((s) => s.id === item.sessionId)) {
      queue.value = queue.value.filter((q) => q.id !== item.id);
      error.value = t("chat.error.noSession");
      continue;
    }
    queue.value = queue.value.filter((q) => q.id !== item.id);
    startQueued(item);
  }
}
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

/**
 * Сколько сообщений держим в DOM.
 *
 * Длинный диалог (сотни сообщений и мыслей) на телефоне иначе держит весь DOM
 * и подвисает при скролле и стриме. Старое подгружается кнопкой «показать раньше»,
 * индекс остаётся сквозной по `feed` — от него зависят блоки размышлений и длительности.
 */
const feedLimit = ref(FEED_WINDOW);

const renderedFeed = computed(() => {
  const list = feed.value;
  const start = Math.max(0, list.length - feedLimit.value);
  return list.slice(start).map((message, i) => ({ message, index: start + i }));
});

/** Сколько сообщений скрыто над окном рендера. */
const hiddenCount = computed(() => Math.max(0, feed.value.length - feedLimit.value));

function showEarlier(): void {
  feedLimit.value += FEED_WINDOW;
}

// Переключились на другой диалог — окно снова последние сообщения.
watch(activeSessionId, () => {
  feedLimit.value = FEED_WINDOW;
});

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
    agents.value.find((a) => a.id === (message.responderId || activeSession.value?.agentId)) ??
    activeAgent.value;
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

/**
 * История — все диалоги, без деления по агенту (решение Сергея, 22.11.2026):
 * по умолчанию видно всё, а нужный агент выбирается фильтром в списке.
 */
const allSessions = computed<Session[]>(() => sessions.value);

/** История — все диалоги; агент выбирается чипами над списком. */
const {
  filter: historyAgent,
  agentsInUse: historyAgents,
  filtered: sessionsOfAgent,
} = useAgentFilter(allSessions, agents);

/** Имя агента для строки истории (свой у каждой сессии). */
function agentNameOf(id: string): string {
  return agents.value.find((agent) => agent.id === id)?.name?.trim() || t("chat.agent");
}

/** Индикаторы хода показываем только в том диалоге, где идёт ответ. */
const liveStreaming = computed(() => activeTurn.value?.streaming ?? "");
const liveTyping = computed(() => activeTurn.value?.typing === true);

const filteredSessions = computed<Session[]>(() => {
  const query = historyQuery.value.trim().toLowerCase();
  const byAgent = sessionsOfAgent.value;
  const list = query
    ? byAgent.filter((s) => s.title.toLowerCase().includes(query))
    : [...byAgent];
  // Закреплённые сверху, дальше — по времени обновления.
  return list.sort((a, b) => {
    const pinA = a.pinned ? 1 : 0;
    const pinB = b.pinned ? 1 : 0;
    if (pinA !== pinB) return pinB - pinA;
    return b.updatedAt - a.updatedAt;
  });
});

/** Полоска недавних диалогов: порядок вкладок и закрытые живут в useSessionTabs. */
const {
  tabs: recentTabs,
  remember: rememberTab,
  forget: forgetTab,
} = useSessionTabs(allSessions, activeSessionId);

/** Сессии, где агент сейчас отвечает или ждёт своей очереди. */
const busySessionIds = computed<Set<string>>(() => {
  const ids = new Set<string>(Object.keys(turns.value));
  for (const id of dispatching.value) ids.add(id);
  for (const item of queue.value) {
    if (item.sessionId) ids.add(item.sessionId);
  }
  return ids;
});

/** Очередь открытого диалога: у каждой сессии своя, чужие ждут у себя. */
const sessionQueue = computed(() =>
  queue.value.filter((q) => !q.sessionId || q.sessionId === activeSessionId.value),
);

/** Пользователь у нижней границы диалога — новые сообщения можно подтягивать. */
const stickBottom = ref(true);

function nearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 48;
}

/* ── Стрелки прокрутки: видны везде, где есть куда листать ────────────── */

/** Есть ли куда листать вверх/вниз — иначе шеврон бесполезен. */
const canJumpTop = ref(false);
const canJumpEnd = ref(false);
/** Шевроны нужны на любом экране: показываем, когда есть куда прокрутить. */
const jumpVisible = computed(() => canJumpTop.value || canJumpEnd.value);

function updateJumpHints(): void {
  const el = messagesEl.value;
  if (!el) {
    canJumpTop.value = false;
    canJumpEnd.value = false;
    return;
  }
  canJumpTop.value = el.scrollTop > 8;
  canJumpEnd.value = el.scrollHeight - el.scrollTop - el.clientHeight > 8;
}

function jumpToTop(): void {
  const el = messagesEl.value;
  if (!el) return;
  // Наверх ушли осознанно: новые сообщения больше не тянут читателя вниз.
  stickBottom.value = false;
  el.scrollTop = 0;
  updateJumpHints();
}

async function jumpToEnd(): Promise<void> {
  await scrollToBottom(true);
  updateJumpHints();
}

// Лента меняется (новые сообщения, стрим, «показать раньше») — пересчитываем
// доступные направления, даже если читатель не у нижней границы.
watch(
  () => renderedFeed.value.length + hiddenCount.value + (liveStreaming.value ? 1 : 0),
  () => {
    void nextTick(updateJumpHints);
  },
  { flush: "post" },
);

function onMessagesScroll(): void {
  const el = messagesEl.value;
  if (!el) return;
  stickBottom.value = nearBottom(el);
  updateJumpHints();
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
const isLlmAgent = computed(() => capabilitiesOf(activeAgent.value).llm);

const typingLabel = computed(() =>
  t(isLlmAgent.value ? "chat.typing.llm" : "chat.typing", {
    name: activeAgent.value?.name?.trim() || t("chat.agent"),
  }),
);

/** Писать можно сразу: сессия создастся при первом «Отправить». */
const composerPlaceholder = computed(() =>
  isTokenSession(activeSession.value)
    ? t("chat.tokens.composerPlaceholder")
    : t("chat.composerPlaceholder", {
        name: activeAgent.value?.name?.trim() || t("chat.agent"),
      }),
);

/**
 * Что реально уйдёт агенту из текущего черновика: значения уже заменены
 * токенами. Строка над полем показывает это до отправки — видно, какие
 * значения станут токенами и сколько замен движок сделал.
 */
const outgoingDraft = computed(() =>
  isTokenSession(activeSession.value)
    ? replaceValues(draft.value)
    : { text: draft.value, hits: 0 },
);

/** Уникальные имена токенов в том виде, в каком их получит агент. */
const outgoingTokens = computed(() => {
  if (!isTokenSession(activeSession.value)) return [];
  return [...new Set(parseTokens(outgoingDraft.value.text).map((token) => token.name))];
});

/** Подсказка к чипу: значение, если человек как раз смотрит значения. */
function tokenChipTitle(name: string): string {
  const value = viewValues.value ? tokenLookup(name) : undefined;
  return value ? `${value} → ⟦${name}⟧` : `⟦${name}⟧`;
}

const canSend = computed(
  () =>
    agents.value.length > 0 &&
    (draft.value.trim().length > 0 ||
      pendingImages.value.length > 0 ||
      pendingDocs.value.length > 0),
);

/** Композер активен, как только есть хотя бы один агент. */
const composerDisabled = computed(() => agents.value.length === 0);

/** Вложения — только если транспорт объявил `media` (сейчас Pico WS). */
const supportsImages = computed(() => capabilitiesOf(activeAgent.value).media);

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
  updateJumpHints();
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
      updateJumpHints();
    });
  }, 16);
}

// Появление сообщений и стрим подтягиваем только если читатель у нижней границы.
watch([messages, liveStreaming, liveTyping], () => settleToBottom(), { flush: "post" });

/** Растущее поле ввода, как в AiChatPanel (от 1 до 4 строк). */
async function autoGrow(): Promise<void> {
  await nextTick();
  const el = composerEl.value;
  if (!el) return;
  const style = window.getComputedStyle(el);
  const padding =
    (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
  // "normal" в computed style — считаем от размера шрифта (line-height 1.4 в CSS).
  const lineHeight =
    parseFloat(style.lineHeight) || Math.round((parseFloat(style.fontSize) || 14.4) * 1.4);
  // Ширина поля зависит от раскладки кнопок: в многострочном режиме блок кнопок
  // уже (~69px против ~156px), и поле шире. Меряем всегда в «узком» режиме —
  // иначе на границе строки текст то влезает, то нет, и поле мерцает 1↔2.
  const box = el.closest(".chat-panel__composer-box") as HTMLElement | null;
  const wasMultiline = box?.classList.contains("is-multiline") ?? false;
  if (wasMultiline) box?.classList.remove("is-multiline");
  // Высоту и max-height снимаем: во flex-ряду scrollHeight иначе равен одной строке,
  // хотя текст уже перенёсся. Ширину фиксируем, чтобы перенос не поехал.
  const width = el.clientWidth;
  el.style.maxHeight = "none";
  el.style.height = "0px";
  if (width > 0) el.style.width = `${width}px`;
  const content = Math.max(0, el.scrollHeight - padding);
  el.style.width = "";
  el.style.maxHeight = "";
  const lines = Math.max(1, Math.ceil(content / lineHeight - 0.1));
  composerLines.value = lines;
  // Человек растянул поле за ручку — его высота главнее авторасчёта по строкам.
  el.style.height = `${
    composerManualHeight.value ?? composerFieldHeight(lines, lineHeight, padding)
  }px`;
  if (wasMultiline) box?.classList.add("is-multiline");
}
watch(draft, () => {
  saveDraftSoon();
  void autoGrow();
});

/** Выставить ручную высоту поля и запомнить её: авто-рост её не перебьёт. */
function setComposerManualHeight(px: number): void {
  const value = Math.min(COMPOSER_MANUAL_MAX, Math.max(COMPOSER_MANUAL_MIN, px));
  composerManualHeight.value = Math.round(value);
  const el = composerEl.value;
  if (el) el.style.height = `${composerManualHeight.value}px`;
}

/** Тянем за ручку внизу поля: тач и мышь одинаково, через pointer events. */
function onComposerGripDown(event: PointerEvent): void {
  const el = composerEl.value;
  if (!el) return;
  event.preventDefault();
  const startY = event.clientY;
  const startHeight = el.getBoundingClientRect().height;
  const grip = event.currentTarget as HTMLElement | null;
  try {
    grip?.setPointerCapture?.(event.pointerId);
  } catch {
    // Старый WebView без захвата указателя: хватит слушателей на window.
  }
  const move = (e: PointerEvent) => setComposerManualHeight(startHeight + (e.clientY - startY));
  const stop = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
}

/** Двойной клик по ручке возвращает авторасчёт по строкам. */
function resetComposerHeight(): void {
  composerManualHeight.value = null;
  void autoGrow();
}

/** Кнопка «Очистить» над отправкой: появляется, когда в поле больше одной строки. */
function clearComposer(): void {
  draft.value = "";
  error.value = "";
  void autoGrow();
  void nextTick(() => composerEl.value?.focus());
}

/** «Новый диалог» — просто чистый лист: запись в БД появится после первой отправки. */
function newSession(): void {
  if (!agentId.value && agents.value.length > 0) {
    agentId.value = agents.value[0].id;
  }
  if (!agentId.value) return;
  error.value = "";
  notice.value = "";
  stopDictation();
  clearMessages();
  restoreDraft(null);
  historyOpen.value = false;
  // Новый диалог — сразу к вводу: не заставляем искать поле на телефоне.
  if (compact.value) composerOpen.value = true;
  void nextTick(() => composerEl.value?.focus());
}

async function openSession(id: string): Promise<void> {
  stopDictation();
  // Диалог всегда открываем с конца: прошлые «листания вверх» не переносим.
  stickBottom.value = true;
  await loadMessages(id);
  // Диалог может принадлежать другому агенту: шапка, подписи и стандартные
  // сообщения должны показывать его агента, а не выбранного ранее.
  const target = sessions.value.find((s) => s.id === id);
  if (target && target.agentId !== agentId.value) agentId.value = target.agentId;
  restoreDraft(id);
  rememberTab(id);
  historyOpen.value = false;
  // Открываем диалог на последних сообщениях, а не на первых.
  await scrollToBottom(true);
  settleToBottom();
  void resumePending(id);
}

/** Последний агент запоминается, чтобы после перезагрузки открыть его диалог. */

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
  since?: number,
): Promise<ListenOutcome> {
  const key = await getAgentKey(agent);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), windowMs);
  let heard = false;
  /** Сервер ответил на `turn.resume`: знаем, идёт ли ход на самом деле. */
  const resumeState: { value: { active: boolean; frames: number } | null } = { value: null };
  const shown = () => session.id === activeSessionId.value;
  try {
    const response = await listenToAgent(agent, key, {
      sessionId: session.id,
      history,
      signal: controller.signal,
      since,
      events: {
        onTyping: (on) => {
          heard = true;
          patchTurn(session.id, { typing: on });
        },
        onDelta: (_id, chunk) => {
          heard = true;
          appendStream(session.id, chunk);
        },
        onMessage: async (m) => {
          heard = true;
          await appendMessage(
            session.id,
            "assistant",
            storedContent(m.content, session),
            m.kind,
            undefined,
            undefined,
            m.id,
            agent.id,
          );
        },
        onUpdate: () => {
          heard = true;
        },
        onDelete: async (id) => {
          heard = true;
          await removeMessageByServerId(session.id, id);
        },
        onNotice: (text) => {
          heard = true;
          if (shown()) showNotice(text);
        },
        onLinkState: (state) => {
          if (!shown()) return;
          if (state === "restored") {
            showNotice(t("chat.link.restored"), 4_000);
          } else {
            showNotice(t("chat.link.reconnecting"), 30_000);
          }
        },
        onTurnState: (state) => {
          resumeState.value = state;
          if (state.active || state.frames > 0) heard = true;
        },
      },
    });
    const incoming = await collectIncoming(agent, key, response.attachments ?? []);
    // Догоняем ход, начатый до перезапуска: длительность считаем от последней реплики.
    const requestAt = [...history].reverse().find((m) => m.role === "user")?.createdAt;
    const reply = await appendMessage(
      session.id,
      "assistant",
      storedContent(response.reply, session),
      undefined,
      incoming,
      requestAt ? Date.now() - requestAt : undefined,
      response.serverId,
      agent.id,
      response.model,
      response.usage,
    );
    // Ход на сервере всё-таки состоялся — засчитываем вызов.
    await recordCall(agent.id);
    await refreshUsage();
    if (autoSpeak.value && response.reply.trim() && shown()) {
      speak(reply.id, response.reply);
    }
    return "answered";
  } catch (e) {
    // Сервер ответил `turn.resume`: ход не идёт и ответа в буфере нет —
    // реплику надо повторить, даже если там были одни мысли.
    if ((e as { code?: string }).code === "no_active_turn") return "silent";
    if (resumeState.value && !resumeState.value.active) return "silent";
    return heard ? "alive" : "silent";
  } finally {
    clearTimeout(timer);
    patchTurn(session.id, { typing: false, streaming: "" });
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
  if (isBusySession(sessionId) || resuming.has(sessionId)) return;
  const pending = pendingTurnFor(sessionId);
  if (!pending || !isPendingFresh(pending, Date.now())) return;
  const session = sessions.value.find((s) => s.id === sessionId);
  const agent = session && agents.value.find((a) => a.id === session.agentId);
  if (!session || !agent?.sealedKey) return;
  const list = await listMessages(sessionId);
  if (!shouldResume(list, pending, Date.now())) {
    forgetPendingTurn(sessionId, pending.text);
    return;
  }
  resuming.add(sessionId);
  openTurn(sessionId);
  patchTurn(sessionId, { startedAt: pending.at });
  if (sessionId === activeSessionId.value) notice.value = t("chat.resumeTurn");
  const history = historyForAgent(
    list.filter((m) => m.role !== "system" && (m.kind === undefined || m.kind === "text")),
  );
  let answered = false;
  let alive = false;
  const deadline = Date.now() + RESUME_LISTEN_MAX_MS;
  try {
    while (!answered && Date.now() < deadline) {
      const outcome = await listenTurn(session, agent, history, RESUME_LISTEN_MS, pending.at);
      if (outcome === "answered") {
        answered = true;
        break;
      }
      if (outcome === "silent") break;
      alive = true;
    }
  } finally {
    closeTurn(sessionId);
    if (sessionId === activeSessionId.value) notice.value = "";
    resuming.delete(sessionId);
  }
  if (answered) {
    forgetPendingTurn(sessionId, pending.text);
    return;
  }
  // Ход жив, но ещё думает — повторно не отправляем, догоним в следующий раз.
  if (alive) return;
  await exchange(session, agent, forAgent(pending.text), [], history);
}

/** Вернулись на вкладку — проверяем, не остался ли незавершённый ход. */
function onVisibility(): void {
  if (document.visibilityState !== "visible") return;
  const id = activeSessionId.value;
  if (id) void resumePending(id);
}

/** Пауза перед самостоятельным догоном после обрыва связи. */
const LINK_RETRY_MS = 15_000;
let linkRetryTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Обрыв связи — не ошибка, а пауза: через несколько секунд сами пробуем
 * подобрать ход (сервер копит кадры сессии). Не вышло — догон повторится
 * при возврате на вкладку или при появлении сети.
 */
function scheduleLinkRetry(sessionId: string): void {
  if (linkRetryTimer) clearTimeout(linkRetryTimer);
  linkRetryTimer = setTimeout(() => {
    linkRetryTimer = null;
    if (!online.value) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    void resumePending(sessionId);
  }, LINK_RETRY_MS);
}

// Агент выбран (вручную или автоматически) — поднимаем его последний диалог.
// Диалоги могут читаться ещё с холодного старта: тогда ждём `sessionsLoaded`.
watch(agentId, async (id) => {
  if (!id) return;
  rememberAgent(id);
  if (activeSession.value?.agentId === id) return;
  if (!sessionsLoaded.value) return;
  await openLastSession(id);
});

// Диалоги прочитались позже, чем выбрался агент — иначе лента остаётся пустой.
watch(sessionsLoaded, (loaded) => {
  if (
    !shouldOpenLastSession({
      agentId: agentId.value,
      sessionsLoaded: loaded,
      activeSessionId: activeSessionId.value,
    })
  ) {
    return;
  }
  void openLastSession(agentId.value);
});

// Открытый диалог попадает в полоску вкладок над чатом.
// Смена диалога — читаем с конца, даже если в прошлом листали вверх.
watch(activeSessionId, (id) => {
  stickBottom.value = true;
  if (id) rememberTab(id);
  // Открыли настоящий диалог — намерение «токеновый новый диалог» больше не нужно.
  if (id) pendingTokenMode.value = false;
  // Диалог сменился — забранная реплика возвращается в свою ленту.
  if (lifted.value && lifted.value.message.sessionId !== id) lifted.value = null;
  // Таблица соответствий относится к прежнему диалогу — закрываем.
  tokenSheetOpen.value = false;
  // Подтверждение отправки и выделение — тоже только для прежнего диалога.
  pendingTokenSend.value = false;
  clearSelection();
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
  tokenTrigger.value = null;
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

/** Применить намерение «новый диалог в режиме токенов» к созданной записи. */
async function applyPendingTokenMode(sessionId: string): Promise<void> {
  if (!pendingTokenMode.value) return;
  pendingTokenMode.value = false;
  try {
    await setSessionTokenMode(sessionId, true);
  } catch {
    // Режим не критичен для отправки: значения всё равно уходят токенами.
  }
}

/** Создать диалог под реплику и открыть его (экран и так был пустым). */
async function startSession(text: string): Promise<string | undefined> {
  const agent = activeAgent.value;
  if (!agent) return undefined;
  const created = await createSession(agent.id, sessionTitle(text));
  await applyPendingTokenMode(created.id);
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
  // Очередь лежит в IndexedDB: в режиме токенов текст кладём токенами.
  const target = sessions.value.find((s) => s.id === sessionId);
  const text = storedContent(payload.text, target);
  queue.value = [
    ...queue.value,
    { id: newId("q"), persist, sessionId, at: Date.now(), ...payload, text },
  ];
}

/**
 * Клавиши композера: Shift+Enter / Ctrl+Enter / Cmd+Enter — отправить,
 * простой Enter — перенос строки (решение Сергея, 20.11.2026).
 */
function onComposerKey(event: KeyboardEvent): void {
  if (event.key === "Escape" && tokenTrigger.value) {
    event.preventDefault();
    tokenTrigger.value = null;
    return;
  }
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
  const session = activeSession.value;
  // Первая отправка в токеновом диалоге — обязательное подтверждение.
  // Дальше диалог помнит, что агенту уходят только токены.
  if (session && isTokenSession(session) && !session.tokenSendAck) {
    pendingTokenSend.value = true;
    return;
  }
  await sendNow();
}

async function sendNow(): Promise<void> {
  const payload = takeComposer();
  if (!payload) return;
  // Реплика, забранная в поле ввода: её заменит новое сообщение.
  const replace =
    lifted.value && lifted.value.message.sessionId === activeSessionId.value
      ? lifted.value.message
      : undefined;
  // В этом диалоге уже идёт ход или одновременно работают все слоты —
  // реплика ждёт в очереди своего диалога. Чужой ход ей не помеха.
  const targetId = activeSessionId.value;
  if ((targetId && isBusySession(targetId)) || liveTurnCount() >= MAX_LIVE_TURNS) {
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
  // Справочник подстановок должен быть прочитан: иначе нельзя гарантировать,
  // что настоящие значения не уйдут агенту. Не прочитан — не отправляем.
  if (!tokensReady()) {
    await loadTokens().catch(() => undefined);
    if (!tokensReady()) {
      error.value = t("chat.tokenGuard");
      return false;
    }
  }
  if (!(await withinLimit(agent))) return false;

  if (!session) {
    if (sessionId !== undefined) {
      error.value = t("chat.error.noSession");
      return false;
    }
    const title = sessionTitle(text);
    session = await createSession(agent.id, title);
    // Намерение режима токенов переносим в запись до первой записи истории.
    await applyPendingTokenMode(session.id);
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
  // Агент получает только токены, настоящие значения остаются на устройстве.
  // Полный текст документов тоже уходит агенту — через ту же подстановку.
  const outgoing = documentsToMessage(
    forAgent(text),
    payload.docs.map((doc) => ({ ...doc, text: forAgent(doc.text) })),
  );
  if (persist) {
    await appendMessage(session.id, "user", storedContent(text, session), undefined, attachments);
  }
  // Прежняя реплика из поля ввода больше не нужна: в контекст пойдёт новая.
  if (replace) {
    if (lifted.value?.message.id === replace.id) lifted.value = null;
    await removeMessage(replace);
  }
  const visible = session.id === activeSessionId.value;
  const history = (
    visible ? messages.value : await listMessages(session.id)
  )
    .filter(
      (m) =>
        m.id !== replace?.id &&
        m.role !== "system" &&
        (m.kind === undefined || m.kind === "text"),
    );
  const agentHistory = historyForAgent(history);
  await exchange(session, agent, outgoing, payload.images.map((img) => img.dataUrl), agentHistory);
  return true;
}

/** Отправить реплику из очереди немедленно: текущий ход прерывается. */
function sendQueuedNow(id: string): void {
  const item = queue.value.find((q) => q.id === id);
  if (!item) return;
  queue.value = queue.value.filter((q) => q.id !== id);
  const key = item.sessionId ?? activeSessionId.value;
  // Диалог свободен — реплика уходит сразу, чужие ходы её не ждут.
  if (!key || !isBusySession(key)) {
    startQueued(item);
    return;
  }
  immediate.value = { ...immediate.value, [key]: item };
  stopTurn(key);
}

function removeQueued(id: string): void {
  queue.value = queue.value.filter((q) => q.id !== id);
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



/** Проверка дневного лимита вызовов; false — отправлять нельзя. */
async function withinLimit(agent: Agent): Promise<boolean> {
  if (agent.protocol === "model_pool" || agent.protocol === "model_mix") {
    if (await hasOpenSlot(agent, agents.value)) return true;
    error.value = t("chat.error.modelsExhausted");
    return false;
  }
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
  allowResend = true,
): Promise<void> {
  stopDictation();
  lastText.value = text;
  const startedAt = Date.now();
  // Свой ход у своего диалога: другие диалоги работают параллельно.
  openTurn(session.id);
  patchTurn(session.id, {
    startedAt,
    state: stepTurn(
      stepTurn(idleTurn(), {
        type: "enqueue",
        clientTurnId: `${session.id}:${startedAt}`,
        text,
      }),
      { type: "start" },
    ),
  });
  // Ход помним в том же виде, что и история: в режиме токенов — токенами.
  const pendingText = storedContent(text, session);
  // Запоминаем ход: если вкладку закроют до ответа, при следующем открытии догоним.
  rememberPendingTurn({ sessionId: session.id, text: pendingText, at: Date.now() });
  let failed = false;
  /**
   * Ход на сервере не значится и кадров в буфере нет: реплику надо отправить
   * заново (один раз, чтобы не устроить петлю при недоступном агенте).
   */
  let resend = false;
  const controller = new AbortController();
  patchTurn(session.id, { controller });
  const limit = agent.settings.callLimit;
  // Стрим, ошибки и подсказки — только этого диалога: фоновые не мешают открытому.
  const shown = () => session.id === activeSessionId.value;
  const fail = (text: string) => {
    if (shown()) error.value = text;
    else setSessionError(session.id, text);
  };
  const notify = (text: string, ttl?: number) => {
    if (shown()) showNotice(text, ttl);
  };
  if (shown()) error.value = "";
  else setSessionError(session.id, "");
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
        peers: agents.value,
        openKey: getAgentKey,
        events: {
          onTyping: (on) => {
            patchTurn(session.id, { typing: on });
          },
          onDelta: (_id, chunk) => {
            appendStream(session.id, chunk);
          },
          onMessage: async (m) => {
            await appendMessage(
              session.id,
              "assistant",
              storedContent(m.content, session),
              m.kind,
              undefined,
              Date.now() - startedAt,
              m.id,
              agent.id,
            );
          },
          onDelete: async (id) => {
            await removeMessageByServerId(session.id, id);
          },
          onNotice: (text) => {
            // Служебная плашка сервера: показываем статусом, ответа не ждём молча.
            if (shown()) showNotice(text);
          },
          onLinkState: (state) => {
            // Обрыв связи в фоне — не ошибка: строка статуса вместо красной плашки.
            if (!shown()) return;
            if (state === "restored") {
              showNotice(t("chat.link.restored"), 4_000);
            } else {
              showNotice(t("chat.link.reconnecting"), 30_000);
            }
          },
        },
      },
    );
    const incoming = await collectIncoming(agent, key, response.attachments ?? []);
    const reply = await appendMessage(
      session.id,
      "assistant",
      storedContent(response.reply, session),
      undefined,
      incoming,
      Date.now() - startedAt,
      response.serverId,
      agent.id,
      response.model ||
        (agent.config as { model?: string } | undefined)?.model ||
        agent.settings.llmModel,
      response.usage,
    );
    // Ответ уже в ленте — живое облачко убираем, чтобы не было двух одинаковых.
    patchTurn(session.id, { streaming: "" });
    // Пул и сводка считают лимит по модели внутри fallback.
    if (agent.protocol !== "model_pool" && agent.protocol !== "model_mix") {
      await recordCall(agent.id);
    }
    await refreshUsage();
    forgetPendingTurn(session.id, pendingText);
    if (autoSpeak.value && response.reply.trim() && shown()) {
      speak(reply.id, response.reply);
    }
    if (limit > 0 && shown()) {
      notice.value = t("chat.remaining", { remaining: Math.max(0, limit - usedToday.value) });
    }
  } catch (e) {
    failed = true;
    // Отмена и смысловые ошибки — не догоняем; сетевые обрывы оставляем до повтора.
    const code = (e as { code?: string }).code;
    const retryable = !controller.signal.aborted &&
      code !== undefined &&
      ["network", "ws_closed", "ws_timeout", "ws_connect", "turn_lost"].includes(code);
    if (!retryable) forgetPendingTurn(session.id, pendingText);
    if (code === "turn_lost" && allowResend && !controller.signal.aborted) {
      // Сервер ход не начинал (сокет умер сразу после отправки) — повторяем.
      resend = true;
      fail("");
      notify(t("chat.link.resend"), 8_000);
    } else if (turnOf(session.id)?.stoppedByUser) {
      // «Стоп»: ход прекращён намеренно — это не ошибка, а сообщение-статус.
      fail("");
      notify(t("chat.stopped"));
    } else if (retryable && code !== "ws_timeout") {
      // Обрыв связи — не ошибка пользователя. Строка статуса вместо красной
      // плашки, ход догоняется сам, как только связь вернётся.
      fail("");
      notify(t("chat.link.lost"), 20_000);
      scheduleLinkRetry(session.id);
    } else {
      fail(describeError(e, t));
    }
  } finally {
    const state = turnOf(session.id)?.state;
    if (state) patchTurn(session.id, { state: stepTurn(state, { type: "complete" }) });
    closeTurn(session.id);
    await nextTick();
    if (session.id === activeSessionId.value) composerEl.value?.focus();
    if (resend) {
      // Повтор идёт с тем же текстом, но уже без права на ещё один повтор.
      void exchange(session, agent, text, media, history, false);
      return;
    }
    // «Отправить сейчас» важнее ошибки; иначе тянем следующую реплику этого диалога.
    const next = immediate.value[session.id];
    if (next) {
      const rest = { ...immediate.value };
      delete rest[session.id];
      immediate.value = rest;
      startQueued(next);
    }
    // Освободился слот — отдаём очередь тем диалогам, что ждут.
    // Упавший диалог сразу не переспрашиваем: очередь других важнее.
    void pumpQueue(failed ? session.id : undefined);
  }
}

/**
 * «Повторить ответ»: удаляет ответ и всё, что после него, и отправляет
 * последнюю реплику пользователя заново. Вложения из истории не повторяются —
 * в IndexedDB лежит только миниатюра.
 */
function regenerate(m: Message): void {
  // Перегенерировать можно, только если свободен диалог этого сообщения.
  if (isBusySession(m.sessionId)) return;
  const index = messages.value.findIndex((item) => item.id === m.id);
  // Регенерация стирает хвост диалога — спрашиваем, если терять есть что.
  if (index >= 0 && index < messages.value.length - 1) {
    confirmRegenerateId.value = m.id;
    return;
  }
  void runRegenerate(m);
}

async function runRegenerate(m: Message): Promise<void> {
  if (isBusySession(m.sessionId)) return;
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
  const history = historyForAgent(
    (visible ? messages.value : await listMessages(session.id)).filter(
      (item) => item.role !== "system" && (item.kind === undefined || item.kind === "text"),
    ),
  );
  await exchange(session, agent, forAgent(prompt), [], history);
}

function stop(): void {
  const id = activeSessionId.value;
  if (id) stopTurn(id);
}

/**
 * Остановить ход одного диалога: сначала просим сервер прекратить генерацию
 * (закрытие сокета её не рвёт), затем обрываем локальный запрос.
 */
function stopTurn(sessionId: string): void {
  const turn = turnOf(sessionId);
  if (!turn || turn.stopping) return;
  const session = sessions.value.find((s) => s.id === sessionId);
  const agent = session ? agents.value.find((a) => a.id === session.agentId) : undefined;
  patchTurn(sessionId, { stoppedByUser: true, stopping: true });
  void (async () => {
    try {
      if (agent) {
        const key = await getAgentKey(agent);
        await cancelAgentTurn(agent, key, sessionId);
      }
    } catch {
      // Отмена на сервере вспомогательная — локальный обрыв делаем всё равно.
    } finally {
      patchTurn(sessionId, { stopping: false });
      turnOf(sessionId)?.controller?.abort();
    }
  })();
}

/**
 * Клик по своей реплике забирает её в поле ввода. Кнопки, картинки и
 * выделенный текст не перехватываем — там свои действия.
 */
/** Markdown реплики → безопасный HTML (кеш внутри lib/markdown). */
function mdHtml(text: string): string {
  noteUiBlock(text);
  return renderMarkdown(text, {
    copy: t("chat.copyMessage"),
    tableCopy: t("chat.table.copy"),
    tableCsv: t("chat.table.csv"),
    tableXlsx: t("chat.table.xlsx"),
  });
}

/**
 * P0 контракта плагинов: блок уже находится, рендера ещё нет — один раз
 * пишем в консоль, какой плагин пришёл (или почему блок не принят).
 */
const seenUiBlocks = new Set<string>();
function noteUiBlock(text: string): void {
  if (!text.includes("```gena-ui")) return;
  if (seenUiBlocks.has(text)) return;
  if (seenUiBlocks.size > 200) seenUiBlocks.clear();
  seenUiBlocks.add(text);
  const parts = splitContent(text);
  console.debug("[gena-ui]", parts.block ? `block:${parts.block.plugin}` : "fallback:text", parts.issues);
}


/**
 * Делегированный клик по markdown: кнопка «Копировать» в шапке блока кода.
 * Копирование не критично — при отказе браузера молчим, текст на экране есть.
 */
async function onMarkdownClick(event: MouseEvent): Promise<void> {
  const target = event.target as HTMLElement | null;
  const tableTool = target?.closest(".md-table__tool");
  if (tableTool instanceof HTMLElement) {
    event.preventDefault();
    event.stopPropagation();
    const table = tableTool.closest(".md-table")?.querySelector("table");
    if (!(table instanceof HTMLTableElement)) return;
    const rows = [...table.rows].map((row) =>
      [...row.cells].map((cell) => (cell.textContent ?? "").replace(/\s+/g, " ").trim()),
    );
    if (tableTool.classList.contains("md-table__copy")) {
      const text = toTsv(rows);
      try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
        else copyFallback(text);
      } catch {
        copyFallback(text);
      }
      tableTool.classList.add("md-table__tool--done");
      window.setTimeout(() => tableTool.classList.remove("md-table__tool--done"), 1400);
      return;
    }
    const file = tableTool.classList.contains("md-table__xlsx")
      ? { name: "table.xlsx", blob: xlsxBlob(rows) }
      : { name: "table.csv", blob: new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }) };
    downloadBlob(file.name, file.blob);
    return;
  }
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
function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** MD — исходный markdown, TXT — видимый текст без иконок таблицы. */
function downloadReply(message: Message, kind: "md" | "txt", event: MouseEvent): void {
  const host = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  const visible = host?.closest(".chat-panel__message")?.querySelector(".chat-panel__content");
  const plain =
    visible instanceof HTMLElement && "innerText" in visible
      ? visible.innerText.trim()
      : message.content;
  const text = kind === "md" ? message.content : plain;
  const type = kind === "md" ? "text/markdown" : "text/plain";
  downloadBlob(`reply.${kind}`, new Blob([text], { type: `${type};charset=utf-8` }));
}

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
  // Иначе тап всплывёт к ленте и сразу закроет только что открытое поле.
  event.stopPropagation();
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
  // Фокус в поле: иначе не сработает отмена по потере фокуса, а на телефоне
  // пользователю пришлось бы ещё раз тапать по полю, чтобы начать печатать.
  void nextTick(() => {
    renameEl.value?.focus();
    renameEl.value?.select();
  });
}

/** Клик/тап мимо поля заголовка и кнопки «Переименовать» закрывает режим правки. */
function onRenameOutside(event: Event): void {
  if (!renaming.value) return;
  const target = event.target as HTMLElement | null;
  if (!target?.closest) return;
  if (target.closest("[data-rename-keep]")) return;
  renaming.value = false;
}

/**
 * Второй путь отмены: обычный `click` мимо поля. `pointerdown` на тач-устройствах
 * иногда уходит не в документ (жест забрал браузер), а click приходит всегда.
 */
function onRenameClickOutside(event: Event): void {
  if (!renaming.value) return;
  const target = event.target as HTMLElement | null;
  if (!target?.closest) return;
  if (target.closest("[data-rename-keep]")) return;
  renaming.value = false;
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
  void nextTick(updateJumpHints);
}

onMounted(() => {
  syncViewport();
  // Справочник подстановок нужен уже к первой отправке.
  void loadTokens();
  // Скачанный морфологический словарь даёт падежные написания значений.
  void loadMorph();
  // Реплики, ждавшие ответа, поднимаем из IndexedDB — закрытие вкладки их не теряет.
  void restoreQueue();
  // Вернулись на вкладку чата — показываем конец диалога, а не начало.
  void scrollToBottom(true);
  settleToBottom();
  void nextTick(updateJumpHints);
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
  // Выделение в поле ввода: плашка «заменить на токен» под полем.
  document.addEventListener("selectionchange", onDocSelectionChange);
  document.addEventListener("pointerdown", onQuickOutside, true);
  document.addEventListener("pointerdown", onRenameOutside, true);
  document.addEventListener("click", onRenameClickOutside, true);
  window.addEventListener("keydown", onQuickKey);
  // Постоянное хранилище: IndexedDB не должна вычищаться при нехватке места.
  void navigator.storage?.persist?.();
  // Контент вырос (картинки, раскрытые шаги, стрим) — держим низ, если читатель там.
  if (typeof ResizeObserver !== "undefined") {
    threadObserver = new ResizeObserver(() => settleToBottom());
    if (threadEl.value) threadObserver.observe(threadEl.value);
  }
  // Док-оверлей меняет высоту (растёт поле ввода, очередь, подсказки) — держим запас ленты в актуальном виде.
  if (typeof ResizeObserver !== "undefined") {
    dockObserver = new ResizeObserver(() => syncDockSpace());
    if (dockEl.value) dockObserver.observe(dockEl.value);
  }
  syncDockSpace();
  void nextTick(autoGrow);
  if (typeof ResizeObserver !== "undefined" && composerEl.value) {
    composerObserver = new ResizeObserver(() => {
      const el = composerEl.value;
      if (!el || el.clientWidth === composerWidth) return;
      composerWidth = el.clientWidth;
      void autoGrow();
    });
    composerObserver.observe(composerEl.value);
  }
});

function onCompactChange(event: MediaQueryListEvent): void {
  syncCompact(event.matches);
}

onUnmounted(() => {
  disposeTurns();
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
  document.removeEventListener("selectionchange", onDocSelectionChange);
  document.removeEventListener("pointerdown", onQuickOutside, true);
  document.removeEventListener("pointerdown", onRenameOutside, true);
  document.removeEventListener("click", onRenameClickOutside, true);
  window.removeEventListener("keydown", onQuickKey);
  threadObserver?.disconnect();
  threadObserver = null;
  dockObserver?.disconnect();
  dockObserver = null;
  composerObserver?.disconnect();
  composerObserver = null;
  document.documentElement.style.removeProperty("--app-vvh");
  for (const turn of Object.values(turns.value)) turn.controller?.abort();
});

function useStarter(n: number): void {
  draft.value = t(`chat.starters.${n}` as never);
  void autoGrow();
  composerEl.value?.focus();
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
  <section class="chat-panel" :class="{ 'is-tokens': isTokenSession(activeSession) }">
    <div v-if="isTokenSession(activeSession)" class="chat-panel__watermark" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="4" y="10" width="16" height="10" rx="2.4" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        <circle cx="12" cy="15" r="1.4" />
      </svg>
    </div>
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
          ref="renameEl"
          v-model="renameDraft"
          class="chat-panel__rename"
          data-rename-keep
          :aria-label="t('chat.renamePlaceholder')"
          @keydown.enter.prevent="commitRename"
          @keydown.esc.prevent="renaming = false"
        />
        <button class="chat-panel__tool is-text" type="button" data-rename-keep @click="commitRename">
          {{ t("chat.rename") }}
        </button>
      </template>

      <template v-if="!renaming">
        <button
          type="button"
          class="chat-panel__tool"
          v-tip="t('chat.newDialog')"
          :aria-label="t('chat.newDialog')"
          :disabled="agents.length === 0"
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
          :class="{ 'is-on': isTokenSession(activeSession) }"
          v-tip="t('chat.tokenMode')"
          :aria-label="t('chat.tokenMode')"
          :aria-pressed="isTokenSession(activeSession)"
          @click="toggleTokenMode"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 3l7 3v6c0 4.2-2.9 7.4-7 9-4.1-1.6-7-4.8-7-9V6z" />
            <path d="M9 12l2 2 4-4" />
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

    <div v-if="limitLabel" class="chat-panel__agentbar">
      <span class="chat-panel__usage">{{ limitLabel }}</span>
    </div>

    <SessionTabs
      :tabs="recentTabs"
      :active-id="activeSessionId"
      :busy-ids="busySessionIds"
      @open="onTabClick"
      @close="forgetTab"
      @title="showTitle"
    />

    <div class="chat-panel__stage">
      <TokenSheet
        v-if="tokenSheetOpen"
        :show-values="viewValues"
        @close="tokenSheetOpen = false"
        @toggle-values="viewValues = !viewValues"
        @insert="insertTokenName"
        @open-tokens="openTokensTab"
      />
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
        <div
          class="chat-panel__filter-chips"
          role="group"
          :aria-label="t('chat.filterAgent')"
        >
          <button
            type="button"
            class="chat-panel__filter-chip"
            :class="{ 'is-on': !historyAgent }"
            :aria-pressed="!historyAgent"
            @click="historyAgent = ''"
          >
            {{ t("chat.allAgents") }}
          </button>
          <button
            v-for="agent in historyAgents"
            :key="agent.id"
            type="button"
            class="chat-panel__filter-chip"
            :class="{ 'is-on': historyAgent === agent.id }"
            :aria-pressed="historyAgent === agent.id"
            @click="historyAgent = agent.id"
          >
            {{ agent.name }}
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
              <span class="chat-panel__session-main">
                <span class="chat-panel__session-title">
                  <span
                    v-if="busySessionIds.has(s.id)"
                    class="chat-panel__busy-dot"
                    aria-hidden="true"
                  />{{ s.title }}
                </span>
                <span v-if="!historyAgent" class="chat-panel__session-agent">
                  {{ agentNameOf(s.agentId) }}
                </span>
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
        :style="dockSpace > 0 ? { paddingBottom: `${dockSpace}px` } : null"
        role="log"
        aria-live="polite"
        @scroll="onMessagesScroll"
        @click="onChatTap"
        @dragover.prevent
        @drop.prevent="onDrop"
      >
        <div ref="threadEl" class="chat-panel__thread">
        <div v-if="hiddenCount > 0" class="chat-panel__earlier">
          <button type="button" class="chat-panel__earlier-btn" @click="showEarlier">
            {{ t("chat.showEarlier", { count: hiddenCount }) }}
          </button>
        </div>
        <template v-for="entry in renderedFeed" :key="entry.message.id">
          <div
            v-if="entry.message.role === 'assistant' && entry.message.kind !== 'thought' && turnThoughtText(entry.index)"
            class="chat-panel__thought"
            :class="{ 'is-open': thoughtExpanded(entry.message.id) }"
          >
            <button
              type="button"
              class="chat-panel__thought-toggle"
              :aria-expanded="thoughtExpanded(entry.message.id)"
              @click="toggleThought(entry.message.id)"
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
              <span class="chat-panel__thought-count">{{ turnThoughts(entry.index).length }}</span>
            </button>
            <div class="chat-panel__thought-body">
              <div class="chat-panel__thought-inner">{{ turnThoughtText(entry.index) }}</div>
            </div>
          </div>
          <article
            v-if="entry.message.kind !== 'thought'"
            class="chat-panel__message"
            :class="[
              `chat-panel__message--${entry.message.role}`,
              { 'is-token-target': occurrenceMessageId === entry.message.id },
            ]"
            :data-message-id="entry.message.id"
            @click="onMessageClick($event, entry.message)"
          >
            <span class="chat-panel__role">
              <span class="chat-panel__time">{{ messageClock(entry.message) }}</span>
              <span class="chat-panel__role-name">{{ roleLabel(entry.message) }}</span>
              <span v-if="messageElapsed(entry.index)" class="chat-panel__elapsed">
                {{ messageElapsed(entry.index) }}
              </span>
            </span>
            <div
              v-if="entry.message.content"
              class="chat-panel__content md"
              @click="onMarkdownClick"
              v-html="mdHtml(displayContent(entry.message.content))"
            ></div>
            <details v-if="entry.message.edits?.length" class="chat-panel__edits">
              <summary>{{ t("chat.edited") }}</summary>
              <div
                v-for="(v, i) in entry.message.edits"
                :key="i"
                class="chat-panel__content md"
                @click="onMarkdownClick"
                v-html="mdHtml(displayContent(v))"
              ></div>
            </details>
            <div
              v-if="imagesOf(entry.message).length"
              class="chat-panel__images"
              :data-count="Math.min(imagesOf(entry.message).length, 4)"
            >
              <button
                v-for="(a, i) in imagesOf(entry.message).slice(0, 4)"
                :key="i"
                type="button"
                class="chat-panel__image"
                @click="openAttachment(a)"
              >
                <img :src="a.thumb" alt="" loading="lazy" @load="scrollToBottom()" />
              </button>
            </div>
            <div v-if="filesOf(entry.message).length" class="chat-panel__file-row">
              <span
                v-for="(a, i) in filesOf(entry.message)"
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
                v-if="entry.message.role === 'user' && !entry.message.kind"
                type="button"
                class="chat-panel__action"
                v-tip="t('chat.liftMessage')"
                :aria-label="t('chat.liftMessage')"
                @click="startEdit(entry.message)"
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M4 20h4l10-10a2.8 2.8 0 1 0-4-4L4 16z" />
                </svg>
              </button>
              <button
                type="button"
                class="chat-panel__action"
                v-tip="copiedId === entry.message.id ? t('chat.copied') : t('chat.copyMessage')"
                :aria-label="t('chat.copyMessage')"
                @click="copyText(entry.message.id, entry.message.content)"
              >
                <svg v-if="copiedId === entry.message.id" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m5 13 4 4L19 7" />
                </svg>
                <svg v-else viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="9" y="9" width="11" height="11" rx="2" />
                  <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                </svg>
              </button>
              <button
                v-if="entry.message.role === 'assistant' && speechAvailable"
                type="button"
                class="chat-panel__action"
                :class="{ 'is-on': speakingId === entry.message.id }"
                v-tip="speakingId === entry.message.id ? t('chat.stopSpeaking') : t('chat.speakReply')"
                :aria-label="speakingId === entry.message.id ? t('chat.stopSpeaking') : t('chat.speakReply')"
                :aria-pressed="speakingId === entry.message.id"
                @click="toggleSpeech(entry.message.id, entry.message.content)"
              >
                <svg v-if="speakingId === entry.message.id" viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
                  <rect x="7" y="7" width="10" height="10" rx="2" />
                </svg>
                <svg v-else viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M11 5 6 9H3v6h3l5 4z" />
                  <path d="M16 9a4 4 0 0 1 0 6" />
                </svg>
              </button>
              <button
                v-if="entry.message.role === 'assistant' && (!entry.message.kind || entry.message.kind === 'text') && entry.message.content"
                type="button"
                class="chat-panel__action chat-panel__export"
                v-tip="t('chat.downloadMd')"
                :aria-label="t('chat.downloadMd')"
                @click="downloadReply(entry.message, 'md', $event)"
              >
                MD
              </button>
              <button
                v-if="entry.message.role === 'assistant' && (!entry.message.kind || entry.message.kind === 'text') && entry.message.content"
                type="button"
                class="chat-panel__action chat-panel__export"
                v-tip="t('chat.downloadTxt')"
                :aria-label="t('chat.downloadTxt')"
                @click="downloadReply(entry.message, 'txt', $event)"
              >
                TXT
              </button>
              <button
                v-if="entry.message.role === 'assistant' && entry.index === feed.length - 1 && !busy"
                type="button"
                class="chat-panel__action"
                v-tip="t('chat.regenerate')"
                :aria-label="t('chat.regenerate')"
                @click="regenerate(entry.message)"
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
            <span v-if="activeTurn" class="chat-panel__time">{{
              formatClock(activeTurn.startedAt)
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

      <div v-if="jumpVisible" class="chat-panel__jump">
        <button
          v-if="canJumpTop"
          type="button"
          class="chat-panel__jump-btn"
          v-tip="t('chat.jumpTop')"
          :aria-label="t('chat.jumpTop')"
          @click="jumpToTop"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m6 14 6-6 6 6" />
          </svg>
        </button>
        <button
          v-if="canJumpEnd"
          type="button"
          class="chat-panel__jump-btn"
          v-tip="t('chat.jumpEnd')"
          :aria-label="t('chat.jumpEnd')"
          @click="jumpToEnd"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m6 10 6 6 6-6" />
          </svg>
        </button>
      </div>
    </div>

        <div
          ref="dockEl"
          class="chat-panel__dock"
          :class="{
            'is-overlay': compact && composerOpen,
            'is-float': compact && !composerOpen,
          }"
        >
      <p v-if="!online" class="chat-panel__warning" role="alert">{{ t("chat.offline") }}</p>
      <p v-if="dictationListening" class="chat-panel__recording" role="status" aria-live="polite">
        <span class="chat-panel__recording-dot" aria-hidden="true" />
        {{ t("chat.dictateRecording") }}
      </p>
      <p v-if="dictationMessage" class="chat-panel__warning" role="alert">{{ dictationMessage }}</p>
      <p v-if="attachError" class="chat-panel__warning" role="alert">{{ attachError }}</p>
      <p v-if="fileError" class="chat-panel__warning" role="alert">{{ fileError }}</p>
      <p v-if="errorText" class="chat-panel__warning" role="alert">
        {{ errorText }}
        <button v-if="lastText" type="button" class="chat-panel__link" @click="retry">
          {{ t("chat.retry") }}
        </button>
      </p>
      <p v-if="notice" class="chat-panel__notice" role="status">{{ notice }}</p>

      <div v-if="sessionQueue.length > 0" class="chat-panel__queue">
        <p class="chat-panel__queue-title">
          {{ t("chat.queue.title", { count: sessionQueue.length }) }}
        </p>
        <ul class="chat-panel__queue-list">
          <li v-for="q in sessionQueue" :key="q.id" class="chat-panel__queue-item">
            <span class="chat-panel__queue-text">
              {{ q.text || t("chat.queue.attachment") }}
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

      <div
        v-if="compact && !composerOpen && (canStopHere || quickReplies.length > 0 || turnElapsed || isTokenSession(activeSession))"
        class="chat-panel__open-row"
      >
        <span v-if="turnElapsed" class="chat-panel__turn is-dock" role="status">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7.5V12l3 2" />
          </svg>
          <span>{{ t("chat.turnElapsed", { time: turnElapsed }) }}</span>
        </span>
        <button
          v-if="canStopHere"
          type="button"
          class="chat-panel__open-stop"
          v-tip="t('chat.stop')"
          :aria-label="t('chat.stop')"
          @click="stop"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
            <rect x="6" y="6" width="12" height="12" rx="3" />
          </svg>
        </button>
        <button
          v-if="isTokenSession(activeSession)"
          type="button"
          class="chat-panel__quick-trigger is-token"
          v-tip="t('chat.tokenMode')"
          :aria-label="t('chat.tokenMode')"
          @click="composerOpen = true"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="4" y="10" width="16" height="10" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </svg>
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
        <p v-if="activeAgent" class="chat-panel__quick-agent">{{ activeAgent.name }}</p>
      </div>

      <p v-if="lifted" class="chat-panel__lift" role="status">
        <span>{{ t("chat.lifted") }}</span>
        <button type="button" class="chat-panel__link" @click="cancelLift">
          {{ t("chat.cancel") }}
        </button>
      </p>

      <p v-if="turnElapsed && (!compact || composerOpen)" class="chat-panel__turn" role="status">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7.5V12l3 2" />
        </svg>
        <span>{{ t("chat.turnElapsed", { time: turnElapsed }) }}</span>
      </p>

      <div
        v-if="isTokenSession(activeSession) && (!compact || composerOpen)"
        class="chat-panel__tokenbar"
        role="group"
        :aria-label="t('chat.tokens.bar')"
      >
        <span class="chat-panel__tokenbar-lock" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="4" y="10" width="16" height="10" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </svg>
        </span>
        <button
          type="button"
          class="chat-panel__token-btn is-icon"
          v-tip="t('chat.tokens.matches')"
          :aria-label="t('chat.tokens.matches')"
          @click="openDictionary"
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="4" y="4" width="16" height="16" rx="2" />
            <path d="M4 9h16M9 9v11" />
          </svg>
        </button>
        <button
          type="button"
          class="chat-panel__token-btn is-icon"
          data-token-trigger
          v-tip="t('chat.tokens.insert')"
          :aria-label="t('chat.tokens.insert')"
          :aria-expanded="tokenPickOpen"
          @click="toggleTokenPick"
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M9 4H5v16h4" />
            <path d="M15 4h4v16h-4" />
          </svg>
        </button>
        <button
          v-if="activeSession"
          type="button"
          class="chat-panel__token-btn is-icon"
          v-tip="viewValues ? t('chat.viewTokens') : t('chat.viewData')"
          :aria-label="viewValues ? t('chat.viewTokens') : t('chat.viewData')"
          :aria-pressed="!viewValues"
          @click="viewValues = !viewValues"
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
            <circle cx="12" cy="12" r="2.6" />
            <path v-if="viewValues" d="M4 4l16 16" />
          </svg>
        </button>
        <button
          type="button"
          class="chat-panel__token-btn is-icon is-exit"
          v-tip="t('chat.tokens.exit')"
          :aria-label="t('chat.tokens.exit')"
          @click="leaveTokenMode"
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M9 4H5v16h4" />
            <path d="M12 12h9" />
            <path d="m17 8 4 4-4 4" />
          </svg>
        </button>
      </div>

      <div
        v-if="tokenPickVisible"
        class="chat-panel__token-pick"
        role="group"
        :aria-label="t('chat.tokens.insert')"
      >
        <button
          v-for="name in tokenPickNames"
          :key="name"
          type="button"
          class="chat-panel__quick-item"
          @click="insertTokenName(name)"
        >
          ⟦{{ name }}⟧
        </button>
      </div>

      <form
        v-if="!compact || composerOpen"
        ref="composerForm"
        class="chat-panel__composer"
        :class="{ 'is-token-mode': isTokenSession(activeSession) }"
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
        <div
          v-if="isTokenSession(activeSession)"
          class="chat-panel__token-draft"
          role="status"
          :aria-label="t('chat.tokens.outgoing')"
        >
          <span class="chat-panel__token-draft-label">{{ t("chat.tokens.outgoing") }}</span>
          <button
            v-for="name in outgoingTokens"
            :key="name"
            type="button"
            class="chat-panel__token-chip"
            :title="tokenChipTitle(name)"
            @click="openDictionary"
          >
            ⟦{{ name }}⟧
          </button>
          <span v-if="outgoingTokens.length === 0" class="chat-panel__token-draft-empty">
            {{ t("chat.tokens.outgoingEmpty") }}
          </span>
          <span v-else-if="outgoingDraft.hits > 0" class="chat-panel__token-draft-hits">
            {{ t("chat.tokens.outgoingHits", { count: outgoingDraft.hits }) }}
          </span>
          <button
            type="button"
            class="chat-panel__token-draft-add is-icon"
            v-tip="t('chat.tokens.matches')"
            :aria-label="t('chat.tokens.matches')"
            @click="openDictionary"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
        <div
          class="chat-panel__composer-box"
          :class="{ 'is-recording': dictationListening, 'is-multiline': composerMultiline }"
        >
          <div class="chat-panel__composer-lead">
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
          <div class="chat-panel__agent-pick" data-agent-trigger>
            <button
              type="button"
              class="chat-panel__icon-btn"
              :class="{ 'is-on': agentMenuOpen }"
              v-tip="t('chat.agent')"
              :aria-label="t('chat.agent')"
              :aria-expanded="agentMenuOpen"
              :disabled="composerDisabled || agents.length === 0"
              @click="guardBlur(); toggleAgentMenu()"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="8" r="3" />
                <path d="M5 19a7 7 0 0 1 14 0" />
              </svg>
            </button>
            <div
              v-if="agentMenuOpen"
              class="chat-panel__agent-menu"
              role="listbox"
              :aria-label="t('chat.agent')"
            >
              <button
                v-for="agent in agents"
                :key="agent.id"
                type="button"
                class="chat-panel__agent-option"
                :class="{ 'is-on': agent.id === (activeSession?.agentId || agentId) }"
                role="option"
                :aria-selected="agent.id === (activeSession?.agentId || agentId)"
                @click="chooseAgent(agent.id)"
              >
                {{ agent.name }}
              </button>
            </div>
          </div>
          </div>
          <textarea
            ref="composerEl"
            v-model="draft"
            class="chat-panel__input"
            rows="1"
            enterkeyhint="enter"
            :placeholder="composerPlaceholder"
            :aria-label="composerPlaceholder"
            :disabled="composerDisabled"
            @keydown="onComposerKey"
            @input="onComposerInput"
            @select="onComposerSelect"
            @pointerup="onComposerSelectSoon"
            @touchend="onComposerSelectSoon"
            @keyup="onComposerSelectSoon"
            @paste="onPaste"
          />
          <div class="chat-panel__composer-stack">
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
          </div>
          <div class="chat-panel__composer-stack chat-panel__composer-stack--send">
            <button
              v-if="composerMultiline"
              type="button"
              class="chat-panel__icon-btn chat-panel__clear"
              v-tip="t('chat.clearInput')"
              :aria-label="t('chat.clearInput')"
              @click="guardBlur(); clearComposer()"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
            <button
              v-if="busy"
              type="button"
              class="chat-panel__send is-stop"
              v-tip="t('chat.stop')"
              :aria-label="t('chat.stop')"
              @click="stop"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                <rect x="5" y="5" width="14" height="14" rx="2.5" />
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
          <span
            class="chat-panel__grip"
            role="separator"
            aria-orientation="horizontal"
            v-tip="t('chat.resizeInput')"
            :aria-label="t('chat.resizeInput')"
            @pointerdown="onComposerGripDown"
            @dblclick="resetComposerHeight"
          />
        </div>
        <div v-if="pendingTokenSend" class="chat-panel__token-confirm" role="alert">
          <p class="chat-panel__token-confirm-text">
            {{ t("chat.tokens.confirmSend", { count: outgoingDraft.hits }) }}
          </p>
          <div class="chat-panel__token-confirm-actions">
            <button type="button" class="chat-panel__token-btn" @click="cancelTokenSend">
              {{ t("chat.cancel") }}
            </button>
            <button
              type="button"
              class="chat-panel__token-btn is-primary"
              @click="confirmTokenSend"
            >
              {{ t("chat.tokens.confirmSendAction") }}
            </button>
          </div>
        </div>

        <div
          v-if="selectionBanner"
          class="chat-panel__selection"
          role="group"
          :aria-label="t('chat.tokens.selection')"
        >
          <span class="chat-panel__selection-text" :title="bannerFragment">
            «{{ bannerFragment }}»
          </span>
          <template v-if="selectionMatch || occurrenceToken">
            <span class="chat-panel__selection-target">⟦{{ bannerToken }}⟧</span>
            <span v-if="occurrenceTotal > 1" class="chat-panel__selection-nav">
              <button
                type="button"
                class="chat-panel__selection-arrow"
                v-tip="t('chat.tokens.prevOccurrence')"
                :aria-label="t('chat.tokens.prevOccurrence')"
                @click="stepOccurrence(-1)"
              >
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m14 6-6 6 6 6" />
                </svg>
              </button>
              <span class="chat-panel__selection-count">
                {{ t("chat.tokens.occurrence", { index: occurrenceIndex + 1, total: occurrenceTotal }) }}
              </span>
              <button
                type="button"
                class="chat-panel__selection-arrow"
                v-tip="t('chat.tokens.nextOccurrence')"
                :aria-label="t('chat.tokens.nextOccurrence')"
                @click="stepOccurrence(1)"
              >
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m10 6 6 6-6 6" />
                </svg>
              </button>
            </span>
            <span v-if="bannerScope" class="chat-panel__selection-scope">{{ bannerScope }}</span>
            <button
              type="button"
              class="chat-panel__token-btn is-icon"
              v-tip="t('chat.tokens.replaceSelection')"
              :aria-label="t('chat.tokens.replaceSelection')"
              @click="onReplaceClick"
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="m5 13 4 4L19 7" />
              </svg>
            </button>
            <button
              v-if="occurrenceTotal > 1"
              type="button"
              class="chat-panel__token-btn chat-panel__selection-all"
              @click="replaceAllOccurrences"
            >
              {{ t("chat.tokens.replaceAll", { count: occurrenceTotal }) }}
            </button>
          </template>
          <template v-else>
            <input
              v-model="selectionName"
              class="chat-panel__selection-input"
              type="text"
              :placeholder="t('tokens.name')"
              :aria-label="t('tokens.name')"
            />
            <button
              type="button"
              class="chat-panel__token-btn is-icon"
              v-tip="t('chat.tokens.makeToken')"
              :aria-label="t('chat.tokens.makeToken')"
              :disabled="!selectionName.trim()"
              @click="createTokenFromSelection"
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
            <span v-if="selectionSuggestions.length > 0" class="chat-panel__selection-suggest">
              <button
                v-for="name in selectionSuggestions"
                :key="name"
                type="button"
                class="chat-panel__selection-sug"
                @click="selectionName = name"
              >
                ⟦{{ name }}⟧
              </button>
            </span>
          </template>
          <span v-if="occurrenceBlockedHint" class="chat-panel__selection-hint">
            {{ occurrenceBlockedHint }}
          </span>
          <button
            type="button"
            class="chat-panel__selection-close"
            v-tip="t('chat.cancel')"
            :aria-label="t('chat.cancel')"
            @click="dismissSelection"
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      </form>
      <div v-if="stickBottom" class="chat-panel__footer">
        <AppFooter />
      </div>
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
      :open="selectionConfirm !== null"
      :title="t('chat.tokens.replaceTitle')"
      :message="t('chat.tokens.replaceQuestion', { name: selectionConfirm?.name ?? '' })"
      :confirm-label="t('chat.tokens.replaceSelection')"
      :cancel-label="t('chat.cancel')"
      @confirm="confirmSelectionReplace"
      @cancel="selectionConfirm = null"
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
  /* Строки над лентой не сжимаются: иначе при нехватке высоты (плашка обновления,
     ландшафт) браузер режет их, и заголовки вкладок уезжают под край панели. */
  flex: 0 0 auto;
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
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px 6px;
  border-bottom: 1px solid var(--border);
}

.chat-panel__agent {
  width: auto;
  max-width: min(240px, 46vw);
  min-width: 0;
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

/* Агент отвечает (или реплика ждёт очереди) — диалог в списке выделяем жирным. */
.chat-panel__session.is-busy .chat-panel__session-title {
  font-weight: 650;
  color: var(--text);
}

.chat-panel__session-title .chat-panel__busy-dot {
  display: inline-block;
  margin-inline-end: 6px;
  vertical-align: middle;
}

.chat-panel__search {
  padding: 6px 10px;
}

/* Фильтр истории по агенту: чипы «Все агенты» + те, у кого есть диалоги. */
.chat-panel__filter-chips {
  display: flex;
  gap: 6px;
  margin: 6px 0 4px;
  overflow-x: auto;
  scrollbar-width: none;
}

.chat-panel__filter-chips::-webkit-scrollbar {
  display: none;
}

.chat-panel__filter-chip {
  flex: 0 0 auto;
  max-width: 11rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--panel);
  color: var(--muted);
  font: inherit;
  font-size: 0.76rem;
  cursor: pointer;
}

.chat-panel__filter-chip.is-on {
  border-color: var(--accent);
  background: var(--panel-2);
  color: var(--text);
  font-weight: 600;
}

.chat-panel__session-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  text-align: start;
}

.chat-panel__session-agent {
  color: var(--muted);
  font-size: 0.7rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

/* Футер сразу под полем ввода, одной низкой строкой. */
.chat-panel__footer {
  flex: 0 0 auto;
  margin: 0;
  line-height: 1;
}

.chat-panel__footer :deep(.app-footer) {
  padding: 0 2px 2px;
  border-top: 0;
  background: transparent;
  line-height: 1;
}

/* Кнопка «показать раньше»: над окном рендера, по центру, ненавязчивая. */
.chat-panel__earlier {
  display: flex;
  justify-content: center;
  padding: 2px 0 4px;
}

.chat-panel__earlier-btn {
  border: 1px dashed var(--border);
  background: transparent;
  color: var(--muted);
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 0.78rem;
  cursor: pointer;
}

.chat-panel__earlier-btn:hover {
  color: var(--text);
  border-color: var(--accent);
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

/* Живой счётчик хода: виден всё время, пока агент работает. */
.chat-panel__turn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin: 0 0 6px;
  padding: 3px 10px;
  align-self: flex-start;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--panel-2);
  color: var(--muted);
  font-size: 0.72rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  /* Как кнопки в доке: полупрозрачная, чтобы не спорить с лентой. */
  opacity: 0.62;
}

.chat-panel__turn svg {
  flex: 0 0 auto;
  opacity: 0.8;
}

/* На телефоне без открытого поля ввода — в доке, рядом со «Стоп». */
.chat-panel__turn.is-dock {
  margin: 0;
  align-self: center;
  padding: 6px 12px;
  font-size: 0.74rem;
  background: color-mix(in srgb, var(--accent) 10%, var(--panel));
  border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
  color: var(--text);
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

.chat-panel__message-actions {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
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
  padding: 0 8px 4px;
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
  position: relative;
  display: flex;
  /* Подсказка и кнопки — по центру высоты поля, а не прижаты к низу. */
  align-items: center;
  gap: 6px;
  padding: 5px 6px 5px 10px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--panel-2);
}

/* Ручка ручного растяжения поля: тянем вверх/вниз, двойной клик — сброс. */
.chat-panel__grip {
  position: absolute;
  left: 50%;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 8px;
  transform: translate(-50%, 50%);
  color: var(--muted);
  opacity: 0.55;
  cursor: ns-resize;
  touch-action: none;
}

.chat-panel__grip::after {
  content: "";
  width: 20px;
  height: 2px;
  border-radius: 2px;
  background: currentColor;
  box-shadow: 0 -3px 0 currentColor;
}

.chat-panel__grip:hover {
  opacity: 1;
  color: var(--text);
}

/* Режим токенов: поле ввода заметно отличается от обычного диалога. */
.chat-panel__composer.is-token-mode .chat-panel__composer-box {
  border-color: var(--tokens-edge);
  background: var(--tokens-bg);
}

.chat-panel__composer.is-token-mode .chat-panel__composer-box:focus-within {
  border-color: var(--accent);
}

/* Строка «что уйдёт агенту»: чипы токенов и счётчик автозамен. */
.chat-panel__token-draft {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  border: 1px dashed color-mix(in srgb, var(--accent) 38%, var(--border));
  border-radius: 10px;
}

.chat-panel__token-draft-label {
  font-size: 0.72rem;
  color: var(--muted);
}

.chat-panel__token-chip {
  padding: 2px 6px;
  border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--border));
  border-radius: 999px;
  background: var(--panel);
  color: var(--accent);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.74rem;
  line-height: 1.2;
  overflow-wrap: anywhere;
  cursor: pointer;
}

.chat-panel__token-chip:hover,
.chat-panel__token-chip:focus-visible {
  border-color: var(--accent);
}

.chat-panel__token-draft-empty {
  font-size: 0.72rem;
  color: var(--muted);
}

.chat-panel__token-draft-hits {
  font-size: 0.72rem;
  color: var(--ok);
}

.chat-panel__token-draft-add {
  margin-inline-start: auto;
  padding: 2px 7px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--panel);
  color: var(--muted);
  font: inherit;
  font-size: 0.72rem;
  cursor: pointer;
}

.chat-panel__token-draft-add.is-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 20px;
  padding: 0;
}

.chat-panel__token-draft-add:hover,
.chat-panel__token-draft-add:focus-visible {
  border-color: var(--accent);
  color: var(--accent);
}

/* Скрепка и агент в один ряд, пока поле в одну строку. */
.chat-panel__composer-lead {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0;
}

/* С двух строк выбор агента уходит под скрепку. */
.chat-panel__composer-box.is-multiline .chat-panel__composer-lead {
  flex-direction: column;
  justify-content: center;
  gap: 2px;
}

.chat-panel__composer-box.is-multiline .chat-panel__composer-lead .chat-panel__icon-btn {
  width: 26px;
  height: 26px;
}

.chat-panel__composer-box.is-multiline .chat-panel__composer-lead .chat-panel__icon-btn svg {
  width: 16px;
  height: 16px;
}

/* Кнопки — в один ряд с полем: по умолчанию ввод ровно в одну строку. */
.chat-panel__composer-stack {
  display: flex;
  flex: 0 0 auto;
  flex-direction: row;
  align-items: center;
  gap: 3px;
}

/* Две и более строк текста — кнопки в два столбца справа:
   «очистить» по центру над отправкой, микрофон и молния вплотную к ней. */
.chat-panel__composer-box.is-multiline .chat-panel__composer-stack {
  flex-direction: column;
  justify-content: center;
  gap: 2px;
}

.chat-panel__composer-box.is-multiline .chat-panel__composer-stack--send {
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

.chat-panel__composer-box.is-multiline .chat-panel__clear {
  width: 22px;
  height: 22px;
  border-radius: 8px;
}

.chat-panel__composer-box.is-multiline .chat-panel__clear svg {
  width: 14px;
  height: 14px;
}

/* В многострочном режиме отправка чуть компактнее — столбец кнопок ниже. */
.chat-panel__composer-box.is-multiline .chat-panel__send.is-primary {
  width: 32px;
  height: 32px;
}

.chat-panel__composer-box.is-multiline .chat-panel__send.is-stop {
  width: 26px;
  height: 26px;
}

.chat-panel__composer-stack .chat-panel__icon-btn {
  width: 26px;
  height: 26px;
  border-radius: 9px;
}

.chat-panel__composer-stack .chat-panel__icon-btn svg {
  width: 16px;
  height: 16px;
}

/* «Очистить» появляется над отправкой, когда в поле больше одной строки. */
.chat-panel__clear {
  color: var(--muted);
  opacity: 0.75;
}

.chat-panel__clear:hover:not(:disabled) {
  color: var(--danger);
  opacity: 1;
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}

.chat-panel__composer-box:focus-within {
  border-color: var(--accent);
}

.chat-panel__composer-box.is-recording {
  border-color: var(--danger);
}

.chat-panel__input {
  flex: 1 1 auto;
  align-self: center;
  min-width: 0;
  min-height: 32px;
  /* Высоту считает autoGrow() по замеру строк; field-sizing: content
     конфликтует с ним и даёт мерцание на границе строк. */
  padding: 6px 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--text);
  font-size: 0.9rem;
  line-height: 1.4;
  resize: none;
  overflow-y: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.chat-panel__input:focus {
  outline: none;
}

/* Подсказка мельче текста, но строка та же: иначе глифы сидят выше середины поля. */
.chat-panel__input::placeholder {
  font-size: 0.72rem;
  line-height: calc(0.9rem * 1.4);
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
  gap: 10px;
  align-items: center;
  justify-content: flex-end;
}

.chat-panel__quick-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 46px;
  height: 46px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: var(--panel-2);
  color: var(--accent);
  opacity: 0.62;
  cursor: pointer;
  transition: opacity 0.15s ease, border-color 0.15s ease;
}

.chat-panel__quick-trigger:hover,
.chat-panel__quick-trigger:focus-visible {
  opacity: 1;
  color: var(--text);
  border-color: var(--accent);
}

/* «Стоп» в доке: полупрозрачная круглая кнопка, видна пока агент работает */
.chat-panel__open-stop {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 46px;
  height: 46px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: var(--panel-2);
  color: var(--danger);
  opacity: 0.62;
  cursor: pointer;
  transition: opacity 0.15s ease, border-color 0.15s ease;
}

.chat-panel__open-stop:hover,
.chat-panel__open-stop:focus-visible {
  opacity: 1;
  border-color: var(--danger);
  color: var(--text);
}

/* --- Шевроны прокрутки: по центру правого края --------------------------- */
.chat-panel__jump {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: none;
}

.chat-panel__jump-btn {
  pointer-events: auto;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: var(--panel);
  color: var(--muted);
  opacity: 0.55;
  cursor: pointer;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
  transition: opacity 140ms ease, color 140ms ease;
}

.chat-panel__jump-btn:hover,
.chat-panel__jump-btn:active {
  opacity: 0.95;
  color: var(--text);
}

/* --- Режим токенов: отдельный тип диалога --------------------------------- */
/* Фон заметно меняется (не color-mix — он не во всех WebView), в нём
   полупрозрачный замок — видно, что диалог защищённый. */
.chat-panel.is-tokens {
  isolation: isolate;
  border-color: var(--tokens-edge);
  background-color: var(--tokens-bg);
  background-image: linear-gradient(180deg, var(--tokens-tint), transparent 62%);
}

.chat-panel__watermark {
  position: absolute;
  inset: 0;
  z-index: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  color: var(--accent);
  opacity: 0.1;
}

.chat-panel__watermark svg {
  width: min(46%, 240px);
  height: auto;
}

.chat-panel.is-tokens .chat-panel__dock.is-overlay {
  background: var(--tokens-bg);
}

.chat-panel__tokenbar {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 2px;
  padding: 2px 4px;
  border: 1px solid var(--tokens-edge);
  border-radius: 10px;
  background: var(--panel-2);
  overflow-x: auto;
  scrollbar-width: none;
}

.chat-panel__tokenbar::-webkit-scrollbar {
  display: none;
}

.chat-panel__tokenbar-lock {
  display: inline-flex;
  flex: 0 0 auto;
  padding: 0 2px;
  color: var(--danger);
}

.chat-panel__token-btn {
  padding: 5px 9px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--panel);
  color: var(--text);
  font: inherit;
  font-size: 0.78rem;
  line-height: 1.2;
  cursor: pointer;
}

/* Иконочная кнопка панели: компактный квадрат, смысл — в тултипе. */
.chat-panel__token-btn.is-icon {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 24px;
  padding: 0;
  border-radius: 8px;
  color: var(--muted);
}

.chat-panel__token-btn.is-icon:hover,
.chat-panel__token-btn.is-icon:focus-visible {
  color: var(--text);
  border-color: var(--tokens-edge);
}

.chat-panel__token-btn:hover,
.chat-panel__token-btn:focus-visible {
  border-color: var(--accent);
}

.chat-panel__token-btn[aria-pressed="true"] {
  border-color: var(--accent);
  color: var(--accent);
}

.chat-panel__token-btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.chat-panel__token-btn.is-exit {
  margin-inline-start: auto;
  color: var(--muted);
}

.chat-panel__token-btn.is-primary {
  border-color: var(--accent);
  color: var(--accent);
}

/* Подтверждение первой отправки в токеновом диалоге. */
.chat-panel__token-confirm {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
  border-radius: 10px;
  background: color-mix(in srgb, var(--panel-2) 86%, var(--accent) 14%);
}

.chat-panel__token-confirm-text {
  flex: 1 1 220px;
  margin: 0;
  font-size: 0.76rem;
  line-height: 1.3;
  color: var(--text);
}

.chat-panel__token-confirm-actions {
  display: flex;
  gap: 4px;
}

/* Плашка действий с выделением — снизу поля, не всплывает у текста. */
.chat-panel__selection {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
  padding: 3px 5px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--panel-2);
}

/* Подсказки имени: то, что предложил словарь выделения. */
.chat-panel__selection-suggest {
  display: flex;
  flex: 1 1 100%;
  flex-wrap: wrap;
  gap: 3px;
}

.chat-panel__selection-sug {
  padding: 1px 6px;
  border: 1px dashed color-mix(in srgb, var(--accent) 45%, var(--border));
  border-radius: 999px;
  background: none;
  color: var(--accent);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.72rem;
  line-height: 1.4;
  cursor: pointer;
}

.chat-panel__selection-sug:hover,
.chat-panel__selection-sug:focus-visible {
  border-style: solid;
}

.chat-panel__selection-text {
  max-width: 45%;
  overflow: hidden;
  font-size: 0.75rem;
  color: var(--muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-panel__selection-target {
  color: var(--accent);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.75rem;
}

/* Стрелки по вхождениям: «2 из 5», назад и вперёд. */
.chat-panel__selection-nav {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  padding: 0 2px;
  border: 1px solid var(--border);
  border-radius: 999px;
}

.chat-panel__selection-arrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: none;
  color: var(--muted);
  cursor: pointer;
}

.chat-panel__selection-arrow:hover,
.chat-panel__selection-arrow:focus-visible {
  background: var(--panel);
  color: var(--text);
}

.chat-panel__selection-count {
  min-width: 34px;
  font-size: 0.68rem;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.chat-panel__selection-scope {
  font-size: 0.66rem;
  color: var(--muted);
  white-space: nowrap;
}

/* «Заменить все N» — заметная кнопка рядом с галочкой. */
.chat-panel__selection-all {
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: none;
  color: var(--accent);
  font: inherit;
  font-size: 0.72rem;
  white-space: nowrap;
  cursor: pointer;
}

.chat-panel__selection-all:hover,
.chat-panel__selection-all:focus-visible {
  border-color: var(--accent);
}

/* Почему часть вхождений не меняется: токен, часть слова, не тот режим. */
.chat-panel__selection-hint {
  flex: 1 1 100%;
  font-size: 0.66rem;
  color: var(--muted);
}

/* Текущее вхождение в ленте — рамка, чтобы было видно, что меняем. */
.chat-panel__message.is-token-target {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.chat-panel__selection-input {
  flex: 1 1 120px;
  min-width: 80px;
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--panel);
  color: var(--text);
  font: inherit;
  font-size: 0.76rem;
}

.chat-panel__selection-input:focus {
  outline: none;
  border-color: var(--accent);
}

.chat-panel__selection-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-inline-start: auto;
  width: 22px;
  height: 20px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: none;
  color: var(--muted);
  font: inherit;
  cursor: pointer;
}

.chat-panel__selection-close:hover {
  border-color: var(--border);
  color: var(--text);
}

.chat-panel__token-pick {
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

.chat-panel__quick-agent {
  margin: 0;
  padding: 0 4px;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.3;
  text-align: center;
}

.chat-panel__agent-pick {
  position: relative;
  display: flex;
  flex: 0 0 auto;
}

.chat-panel__agent-menu {
  position: absolute;
  left: 0;
  bottom: calc(100% + 8px);
  z-index: 40;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 180px;
  max-width: min(280px, 70vw);
  max-height: min(40vh, 280px);
  overflow-y: auto;
  padding: 6px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.2);
}

.chat-panel__agent-option {
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 0.88rem;
  text-align: start;
  cursor: pointer;
}

.chat-panel__agent-option:hover,
.chat-panel__agent-option.is-on {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}

.chat-panel__icon-btn.is-on {
  color: var(--accent);
}

.chat-panel__dock.is-overlay {
  position: absolute;
  inset-inline: 0;
  bottom: 0;
  z-index: 30;
  /* Панель выступает над полем ввода ровно на столько же, на сколько снизу. */
  padding-top: 8px;
  padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px));
  background: var(--panel);
  border-top: 1px solid var(--border);
  box-shadow: 0 -10px 28px rgba(0, 0, 0, 0.22);
}

.chat-panel__dock.is-overlay::before {
  display: none;
}

/* Телефон без ввода: панель прозрачная — над лентой висят только полупрозрачные
   кнопки «Стоп» и молния. Сплошная панель появляется вместе с полем ввода. */
.chat-panel__dock.is-float {
  position: absolute;
  inset-inline: 0;
  bottom: 0;
  z-index: 30;
  padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px));
  background: transparent;
  border: 0;
  box-shadow: none;
  pointer-events: none;
}

.chat-panel__dock.is-float > * {
  pointer-events: auto;
}

/* Сама дорожка кнопок пропускает тапы к чату — срабатывают только кнопки. */
.chat-panel__dock.is-float .chat-panel__open-row {
  pointer-events: none;
}

.chat-panel__dock.is-float .chat-panel__open-row > * {
  pointer-events: auto;
}

.chat-panel__dock.is-float::before {
  display: none;
}

/* Служебные плашки над лентой не должны теряться на тексте сообщений. */
.chat-panel__dock.is-float .chat-panel__warning,
.chat-panel__dock.is-float .chat-panel__notice,
.chat-panel__dock.is-float .chat-panel__lift {
  padding: 4px 8px;
  border-radius: 10px;
  background: var(--panel);
}
</style>

<style>
/* Markdown в ленте приходит через v-html: scoped-атрибут на вставленные
   элементы не попадает, поэтому эти правила — глобальные. */
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

/* Таблица: горизонтальный скролл внутри своего блока, тонкая серая сетка ячеек. */
.md-table {
  --md-grid: color-mix(in srgb, var(--border) 85%, transparent);
}

.md-table__scroll {
  overflow-x: auto;
  overscroll-behavior-x: contain;
  -webkit-overflow-scrolling: touch;
  border: 1px solid var(--md-grid);
  border-radius: 8px;
}

.md-table__tools {
  display: flex;
  gap: 2px;
  margin-top: 4px;
  user-select: none;
}

.md-table__tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.md-table__tool:hover,
.md-table__tool:focus-visible {
  background: rgba(127, 127, 127, 0.18);
  color: var(--text);
}

.md-table__tool::before {
  content: "";
  width: 14px;
  height: 14px;
  background: currentColor;
  -webkit-mask: var(--md-icon-copy) center / contain no-repeat;
  mask: var(--md-icon-copy) center / contain no-repeat;
}

.md-table__csv::before {
  -webkit-mask-image: var(--md-icon-csv);
  mask-image: var(--md-icon-csv);
}

.md-table__xlsx::before {
  -webkit-mask-image: var(--md-icon-xlsx);
  mask-image: var(--md-icon-xlsx);
}

.md-table__tool--done {
  color: var(--ok);
}

.md-table__tool--done::before {
  -webkit-mask-image: var(--md-icon-check);
  mask-image: var(--md-icon-check);
}

.chat-panel__export {
  width: auto;
  flex: 0 0 auto;
  padding: 0 5px;
  font: inherit;
  font-size: 0.62rem;
  letter-spacing: 0.04em;
  user-select: none;
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
  border: 1px solid var(--md-grid);
  text-align: left;
  white-space: nowrap;
}

.md-table thead th {
  background: var(--panel-2);
  font-weight: 600;
}

/* Внешнюю рамку рисует обёртка — у крайних ячеек своих линий не нужно. */
.md-table thead tr > * {
  border-top: 0;
}

.md-table tr > *:first-child {
  border-inline-start: 0;
}

.md-table tr > *:last-child {
  border-inline-end: 0;
}

.md-table tr:last-child > * {
  border-bottom: 0;
}

</style>
