<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import ConnectionsView from "./views/ConnectionsView.vue";
import ChatView from "./views/ChatView.vue";
import SessionsView from "./views/SessionsView.vue";
import AboutView from "./views/AboutView.vue";
import TokensView from "./views/TokensView.vue";
import LanguageSwitcher from "./components/LanguageSwitcher.vue";
import ThemeSwitcher from "./components/ThemeSwitcher.vue";
import AppearanceMenu from "./components/AppearanceMenu.vue";
import InstallButton from "./components/InstallButton.vue";
import AppFooter from "./components/AppFooter.vue";
import { currentLanguageCode } from "./lib/dictation";
import {
  loadSpeechVoices,
  setSpeechPitch,
  setSpeechRate,
  setSpeechVoice,
  setSpeechVolume,
  speak,
  speechPitch,
  speechRate,
  speechVoiceId,
  speechVoiceTick,
  speechVoices,
  speechVolume,
  voiceKey,
  voiceMatchesLanguage,
  voiceProvider,
} from "./lib/speech";
import { agents, loadAgents, loadSessions, sessions } from "./lib/store";
import { putAgent, putSession } from "./storage/db";
import { readSnapshot, writeSnapshot } from "./storage/snapshot";
import { describeStorageFailure, storageError, storageNotice } from "./lib/storage-state";
import { useTheme } from "./lib/theme";
import { watchForUpdate } from "./lib/version-update";
import { useLocale } from "./i18n";
import { trackPageview } from "./analytics/goatcounter";

type Tab = "connections" | "chat" | "sessions" | "tokens" | "about";
const tab = ref<Tab>("chat");
const menuOpen = ref(false);
/** Кнопка «···» и само меню: клик внутри не считается внешним. */
const menuRoot = ref<HTMLElement | null>(null);

function openTab(next: Tab): void {
  tab.value = next;
  menuOpen.value = false;
}

function onPointerDown(event: PointerEvent): void {
  if (!menuOpen.value) return;
  const target = event.target;
  if (target instanceof Node && menuRoot.value?.contains(target)) return;
  menuOpen.value = false;
}
const { t, locale } = useLocale();
const { theme } = useTheme();
/** Иконка бренда: на тёмной теме — тёмный фон и светло-зелёный логотип. */
const brandIcon = computed(
  () => `${import.meta.env.BASE_URL}icon${theme.value === "dark" ? "-dark" : ""}.svg?v=2`,
);
/** Плашка «доступна новая версия»: ставится, когда SW перешёл на новую сборку. */
const updateReady = ref(false);
watchForUpdate(() => {
  updateReady.value = true;
});
function applyUpdate(): void {
  window.location.reload();
}

const voiceOpen = ref(false);
const voiceProviderId = ref("");

const languageVoices = computed(() => {
  speechVoiceTick.value;
  locale.value;
  const lang = currentLanguageCode();
  return speechVoices().filter((voice) => voiceMatchesLanguage(voice, lang));
});

const providers = computed(() => {
  const names = new Set(languageVoices.value.map((voice) => voiceProvider(voice)));
  return [...names];
});

const visibleVoices = computed(() =>
  languageVoices.value.filter(
    (voice) => !voiceProviderId.value || voiceProvider(voice) === voiceProviderId.value,
  ),
);

function openVoice(): void {
  menuOpen.value = false;
  loadSpeechVoices();
  voiceOpen.value = true;
}

function chooseVoice(id: string): void {
  setSpeechVoice(id);
}

function previewVoice(): void {
  speak("voice-preview", t("chat.voice.sample"));
}

function onRange(apply: (value: number) => void, event: Event): void {
  const value = Number((event.target as HTMLInputElement).value);
  if (Number.isFinite(value)) apply(value);
}
/**
 * Загрузить агентов и диалоги; при пустой базе вернуть локальную копию.
 * Ошибку открытия базы показываем в шапке: пустые списки без объяснений
 * выглядят как «данные пропали».
 */
async function loadStorage(): Promise<void> {
  storageError.value = "";
  storageNotice.value = null;
  try {
    await loadAgents();
    await loadSessions();
  } catch (error) {
    storageError.value = describeStorageFailure(error);
    return;
  }

  if (agents.value.length === 0 && sessions.value.length === 0) {
    const snapshot = readSnapshot();
    if (snapshot && snapshot.agents.length + snapshot.sessions.length > 0) {
      try {
        for (const agent of snapshot.agents) await putAgent(agent);
        for (const session of snapshot.sessions) await putSession(session);
        await loadAgents();
        await loadSessions();
        storageNotice.value = { at: snapshot.at };
      } catch {
        // Копия осталась на месте, база работает — второй раз не мешаем.
      }
    }
  }

  // Свежая копия: её хватит, если следующее обновление откроет пустую базу.
  writeSnapshot([...agents.value], [...sessions.value]);
}

/** Кнопка «Повторить»: базой могла заниматься другая вкладка — пробуем снова. */
async function retryStorage(): Promise<void> {
  await loadStorage();
}

/** Дата копии для строки «данные восстановлены». */
function formatSnapshotDate(at: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(at));
  } catch {
    return new Date(at).toLocaleDateString();
  }
}

let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSnapshot(): void {
  if (snapshotTimer) clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    writeSnapshot([...agents.value], [...sessions.value]);
  }, 1_500);
}

onMounted(async () => {
  document.addEventListener("pointerdown", onPointerDown);
  await loadStorage();
});

watch(tab, (value) => trackPageview(value), { immediate: true });

// Любое изменение подключений и диалогов обновляет копию (с задержкой).
watch(
  [agents, sessions],
  () => {
    if (!storageError.value) scheduleSnapshot();
  },
  { deep: true },
);

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onPointerDown);
  if (snapshotTimer) clearTimeout(snapshotTimer);
  snapshotTimer = null;
});
</script>

<template>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <img class="brand-icon" :src="brandIcon" alt="" aria-hidden="true" />
        <div class="brand-text">
          <strong class="brand-name">{{ t("app.name") }}</strong>
          <span class="brand-sub">AI chat</span>
        </div>
      </div>
      <button
        v-if="tab !== 'chat'"
        type="button"
        class="back-btn"
        @click="openTab('chat')"
      >
        {{ t("app.nav.chat") }}
      </button>
      <div ref="menuRoot" class="menu-anchor">
      <button
        type="button"
        class="icon-btn menu-btn"
        :aria-label="t('app.nav.main')"
        :aria-expanded="menuOpen"
        @click="menuOpen = !menuOpen"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <circle cx="12" cy="5" r="1.6" fill="currentColor" />
          <circle cx="12" cy="12" r="1.6" fill="currentColor" />
          <circle cx="12" cy="19" r="1.6" fill="currentColor" />
        </svg>
      </button>
      <div v-if="menuOpen" class="menu" role="menu">
        <button type="button" role="menuitem" @click="openTab('connections')">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M9 17H7a5 5 0 0 1 0-10h2" />
            <path d="M15 7h2a5 5 0 0 1 0 10h-2" />
            <path d="M8 12h8" />
          </svg>
          {{ t("app.nav.connections") }}
        </button>
        <button type="button" role="menuitem" @click="openTab('sessions')">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 5h16" />
            <path d="M4 12h16" />
            <path d="M4 19h10" />
          </svg>
          {{ t("app.nav.sessions") }}
        </button>
        <button type="button" role="menuitem" @click="openTab('chat')">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.5 9.5 0 0 1-3.4-.6L3 21l1.7-5a8.4 8.4 0 0 1-.7-3.4 8.4 8.4 0 0 1 8.4-8.4 8.4 8.4 0 0 1 8.6 8.3z" />
          </svg>
          {{ t("app.nav.chat") }}
        </button>
        <button type="button" role="menuitem" @click="openVoice">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M11 5 6 9H3v6h3l5 4z" />
            <path d="M16 9a4 4 0 0 1 0 6" />
            <path d="M19 6a8 8 0 0 1 0 12" />
          </svg>
          {{ t("chat.voice") }}
        </button>
        <LanguageSwitcher />
        <ThemeSwitcher />
        <AppearanceMenu />
        <div class="menu-row">
          <InstallButton />
        </div>
        <button type="button" role="menuitem" @click="openTab('tokens')">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
            <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5" />
            <path d="M8 7h8M8 11h6" />
          </svg>
          {{ t("app.nav.tokens") }}
        </button>
        <button type="button" role="menuitem" @click="openTab('about')">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v6" />
            <path d="M12 8h.01" />
          </svg>
          {{ t("app.nav.about") }}
        </button>
        <InstallButton as-menu />
      </div>
      </div>
    </header>

    <main class="content" :class="{ 'content--flush': tab === 'chat' }">
      <!-- Новая сборка уже управляет вкладкой: показываем плашку, а не ждём перезагрузки. -->
      <div v-if="updateReady" class="update-bar" role="status">
        <span class="update-bar__text">{{ t("app.updateReady") }}</span>
        <button type="button" class="update-bar__action" @click="applyUpdate">
          {{ t("app.updateAction") }}
        </button>
      </div>
      <!-- База не открылась: объясняем причину и даём повтор, а не пустые списки. -->
      <div v-if="storageError" class="update-bar update-bar--error" role="alert">
        <span class="update-bar__text">
          {{ t(storageError === "blocked" ? "app.storageBlocked" : "app.storageFailed") }}
        </span>
        <button type="button" class="update-bar__action" @click="retryStorage">
          {{ t("app.storageRetry") }}
        </button>
      </div>
      <div v-else-if="storageNotice" class="update-bar" role="status">
        <span class="update-bar__text">
          {{ t("app.storageRestored", { date: formatSnapshotDate(storageNotice.at) }) }}
        </span>
        <button type="button" class="update-bar__action" @click="storageNotice = null">
          {{ t("app.storageDismiss") }}
        </button>
      </div>
      <ConnectionsView v-if="tab === 'connections'" />
      <ChatView
        v-else-if="tab === 'chat'"
        @open-tokens="openTab('tokens')"
        @open-about="openTab('about')"
      />
      <SessionsView v-else-if="tab === 'sessions'" />
      <TokensView v-else-if="tab === 'tokens'" />
      <AboutView v-else />
    </main>

    <AppFooter v-if="tab !== 'chat'" @about="openTab('about')" />

    <div v-if="voiceOpen" class="voice-sheet" role="dialog" :aria-label="t('chat.voice')">
      <button type="button" class="voice-sheet__backdrop" :aria-label="t('chat.close')" @click="voiceOpen = false" />
      <div class="voice-sheet__panel">
        <div class="voice-sheet__head">
          <strong>{{ t("chat.voice") }}</strong>
          <button type="button" class="voice-sheet__close" @click="voiceOpen = false">×</button>
        </div>

        <p class="voice-sheet__label">{{ t("chat.voice.provider") }}</p>
        <div class="voice-sheet__chips">
          <button type="button" :class="{ 'is-on': voiceProviderId === '' }" @click="voiceProviderId = ''">
            {{ t("chat.voice.default") }}
          </button>
          <button
            v-for="name in providers"
            :key="name"
            type="button"
            :class="{ 'is-on': voiceProviderId === name }"
            @click="voiceProviderId = name"
          >
            {{ name }}
          </button>
        </div>

        <p class="voice-sheet__label">{{ t("chat.voice") }}</p>
        <div class="voice-sheet__voices">
          <p v-if="visibleVoices.length === 0" class="voice-sheet__empty">{{ t("chat.voice.empty") }}</p>
          <button
            type="button"
            :class="{ 'is-on': speechVoiceId === '' }"
            @click="chooseVoice('')"
          >
            {{ t("chat.voice.default") }}
          </button>
          <button
            v-for="voice in visibleVoices"
            :key="voiceKey(voice)"
            type="button"
            :class="{ 'is-on': speechVoiceId === voiceKey(voice) }"
            @click="chooseVoice(voiceKey(voice))"
          >
            {{ voice.name }}
          </button>
        </div>

        <label class="voice-sheet__slider">
          <span>{{ t("chat.speechRate") }} · {{ speechRate }}×</span>
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.25"
            :value="speechRate"
            @input="onRange(setSpeechRate, $event)"
          />
        </label>
        <label class="voice-sheet__slider">
          <span>{{ t("chat.voice.pitch") }} · {{ speechPitch }}</span>
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            :value="speechPitch"
            @input="onRange(setSpeechPitch, $event)"
          />
        </label>
        <label class="voice-sheet__slider">
          <span>{{ t("chat.voice.volume") }} · {{ Math.round(speechVolume * 100) }}%</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            :value="speechVolume"
            @input="onRange(setSpeechVolume, $event)"
          />
        </label>
        <button type="button" class="voice-sheet__preview" @click="previewVoice">
          {{ t("chat.voice.preview") }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app {
  /* --app-vvh учитывает клавиатуру: обычный 100vh её не видит. */
  height: var(--app-vvh, 100dvh);
  max-height: var(--app-vvh, 100dvh);
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.topbar {
  --icon-btn-size: 32px;
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  flex-wrap: nowrap;
  min-width: 0;
}

.back-btn {
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  padding: 8px 4px;
  cursor: pointer;
}

.menu-anchor {
  display: contents;
}

.menu-btn {
  margin-inline-start: auto;
}

.menu {
  position: absolute;
  top: calc(100% + 4px);
  inset-inline-end: 8px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 220px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--panel);
  box-shadow: 0 8px 24px rgb(0 0 0 / 12%);
}

.menu > button {
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: start;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
}

.menu > button svg {
  flex: none;
}

.menu > button:hover {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.menu :deep(.menu-line) {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  margin: 0;
  padding: 10px 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
}

.menu :deep(.menu-line:hover) {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.menu :deep(.menu-line svg) {
  flex: none;
}

.menu :deep(.menu-line select) {
  margin-inline-start: auto;
  width: auto;
  max-width: 8.5rem;
  padding: 4px 6px;
  font: inherit;
  font-size: 0.86rem;
}

.menu :deep(.menu-line--width) {
  gap: 8px;
}

.menu :deep(.menu-line input[type="range"]) {
  margin-inline-start: auto;
  width: 6.5rem;
  padding: 0;
  accent-color: var(--accent);
}

.menu :deep(.menu-line__value) {
  flex: none;
  min-width: 2.4rem;
  color: var(--muted);
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
  text-align: end;
}

.menu-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px 6px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

/* Название и подпись — двумя строками: «Gena» жирным, «AI chat» мельче и обычным. */
.brand-text {
  display: flex;
  flex-direction: column;
  justify-content: center;
  line-height: 1.15;
  min-width: 0;
  overflow: hidden;
}

.brand-name {
  font-size: 1rem;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.brand-sub {
  font-size: 0.72rem;
  font-weight: 400;
  color: var(--muted);
  letter-spacing: 0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.brand-icon {
  /* Ровно высота иконочной кнопки: 32×32, рамка рисуется внутри (border-box). */
  width: var(--icon-btn-size);
  height: var(--icon-btn-size);
  box-sizing: border-box;
  display: block;
  border-radius: 8px;
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--border);
}

.topbar nav {
  display: flex;
  gap: 8px;
  flex: none;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--icon-btn-size);
  height: var(--icon-btn-size);
  padding: 0;
  line-height: 0;
}

.content {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 20px;
  max-width: 960px;
  width: 100%;
  margin: 0 auto;
}

/* Чат — без внешних отступов: панель занимает всю область. */
.content--flush {
  display: flex;
  flex-direction: column;
  padding: 0;
  max-width: none;
  overflow: hidden;
}

.content--flush :deep(.chat-panel) {
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  border: 0;
  border-radius: 0;
}

/* Широкий экран: колонка диалога по центру, ширина — из меню (--chat-width). */
@media (min-width: 721px) {
  .content--flush {
    align-items: center;
    background: var(--bg);
  }

  .content--flush > :not(.chat-panel) {
    align-self: stretch;
  }

  .content--flush :deep(.chat-panel) {
    width: min(100%, var(--chat-width, 960px));
    border-inline: 1px solid var(--border);
  }
}

/* Плашка обновления: тонкая полоса, видна на любой вкладке, ничего не перекрывает. */
.update-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--accent) 14%, var(--panel));
  font-size: 0.86rem;
}

.update-bar__action {
  border: 1px solid var(--accent);
  background: var(--panel);
  color: inherit;
  border-radius: 8px;
  padding: 4px 12px;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
}

.update-bar__action:hover {
  background: var(--accent);
  color: #fff;
}

/* Плашка ошибки хранилища: красная рамка, чтобы не путалась с плашкой обновления. */
.update-bar--error {
  background: color-mix(in srgb, #e5484d 14%, var(--panel));
  border-bottom-color: color-mix(in srgb, #e5484d 45%, var(--border));
}

.update-bar--error .update-bar__action {
  border-color: #e5484d;
}

.update-bar--error .update-bar__action:hover {
  background: #e5484d;
}

/* Телефон и узкий планшет: шапка одной строкой, кнопки под палец,
   подпись бренда уступает место кнопке «назад». */
@media (max-width: 720px) {
  .topbar {
    --icon-btn-size: 40px;
    gap: 8px;
    padding: 6px 10px;
  }
  .brand-name {
    font-size: 1rem;
  }
  .back-btn {
    padding: 8px 2px;
    font-size: 0.92rem;
  }
  .content:not(.content--flush) {
    padding: 12px 12px 16px;
  }
  .menu {
    inset-inline-end: 8px;
    width: min(18rem, calc(100vw - 16px));
    max-height: min(70dvh, 32rem);
    overflow: auto;
  }
  .menu > button,
  .menu :deep(.menu-line) {
    min-height: 44px;
  }
  .update-bar {
    justify-content: space-between;
    padding: 8px 12px;
    font-size: 0.9rem;
    text-align: start;
  }
  .voice-sheet__panel {
    padding-bottom: calc(20px + env(safe-area-inset-bottom, 0px));
  }
  .voice-sheet__voices button,
  .voice-sheet__chips button,
  .voice-sheet__preview {
    min-height: 44px;
  }
}

@media (min-width: 721px) {
  .voice-sheet {
    align-items: center;
    padding: 24px;
  }
  .voice-sheet__panel {
    border-radius: 16px;
    box-shadow: 0 16px 48px rgb(0 0 0 / 28%);
  }
}

@media (min-width: 1100px) {
  .topbar {
    padding: 10px 20px;
  }
  .content:not(.content--flush) {
    max-width: 1080px;
    padding: 28px 32px;
  }
  .brand-name {
    font-size: 1.05rem;
  }
}

.voice-sheet {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.voice-sheet__backdrop {
  position: absolute;
  inset: 0;
  border: 0;
  background: rgb(0 0 0 / 45%);
}

.voice-sheet__panel {
  position: relative;
  width: min(520px, 100%);
  max-height: min(80vh, 640px);
  overflow: auto;
  padding: 16px 16px 24px;
  border-radius: 16px 16px 0 0;
  background: var(--panel);
}

.voice-sheet__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.voice-sheet__close {
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font-size: 1.4rem;
  cursor: pointer;
}

.voice-sheet__label {
  margin: 12px 0 6px;
  color: var(--muted);
  font-size: 0.8rem;
}

.voice-sheet__chips,
.voice-sheet__voices {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.voice-sheet__voices {
  flex-direction: column;
  align-items: stretch;
  max-height: 28vh;
  overflow: auto;
}

.voice-sheet__chips button,
.voice-sheet__voices button,
.voice-sheet__preview {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: start;
  padding: 8px 12px;
  cursor: pointer;
}

.voice-sheet__chips button.is-on,
.voice-sheet__voices button.is-on {
  border-color: var(--accent);
  color: var(--accent);
}

.voice-sheet__empty {
  margin: 0;
  color: var(--muted);
  font-size: 0.86rem;
}

.voice-sheet__slider {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 14px;
  font-size: 0.86rem;
}

.voice-sheet__slider input {
  width: 100%;
  padding: 0;
  background: transparent;
  border: 0;
}

.voice-sheet__preview {
  margin-top: 16px;
  width: 100%;
  text-align: center;
  font-weight: 600;
}

</style>
