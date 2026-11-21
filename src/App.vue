<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import ConnectionsView from "./views/ConnectionsView.vue";
import ChatView from "./views/ChatView.vue";
import SessionsView from "./views/SessionsView.vue";
import LanguageSwitcher from "./components/LanguageSwitcher.vue";
import ThemeSwitcher from "./components/ThemeSwitcher.vue";
import InstallButton from "./components/InstallButton.vue";
import AppFooter from "./components/AppFooter.vue";
import { agentId } from "./lib/active-agent";
import { SPEECH_RATES, autoSpeak, setAutoSpeak, setSpeechRate, speechAvailable, speechRate } from "./lib/speech";
import { agents, loadAgents, loadSessions } from "./lib/store";
import { useTheme } from "./lib/theme";
import { watchForUpdate } from "./lib/version-update";
import { useLocale } from "./i18n";

type Tab = "connections" | "chat" | "sessions";
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
const { t } = useLocale();
const { theme } = useTheme();
/** Иконка бренда: на тёмной теме — тёмный фон и светло-зелёный логотип. */
const brandIcon = computed(
  () => `${import.meta.env.BASE_URL}icon${theme.value === "dark" ? "-dark" : ""}.svg?v=2`,
);
const headerAgent = computed(() => agents.value.find((agent) => agent.id === agentId.value));

function headerProtocol(): string {
  const protocol = headerAgent.value?.protocol ?? "http_json";
  return t(("connections.protocol." + protocol) as "connections.protocol.http_json");
}
/** Плашка «доступна новая версия»: ставится, когда SW перешёл на новую сборку. */
const updateReady = ref(false);
watchForUpdate(() => {
  updateReady.value = true;
});
function applyUpdate(): void {
  window.location.reload();
}

function onSpeechRate(event: Event): void {
  const value = Number((event.target as HTMLSelectElement).value);
  if (Number.isFinite(value)) setSpeechRate(value);
}
onMounted(async () => {
  document.addEventListener("pointerdown", onPointerDown);
  await loadAgents();
  await loadSessions();
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onPointerDown);
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
      <div class="topbar-agent">
        <select v-model="agentId" class="topbar-agent__select" :aria-label="t('chat.agent')">
          <option value="">{{ t("chat.selectAgent") }}</option>
          <option v-for="agent in agents" :key="agent.id" :value="agent.id">{{ agent.name }}</option>
        </select>
        <span v-if="headerAgent" class="topbar-agent__protocol">{{ headerProtocol() }}</span>
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
        <div v-if="speechAvailable" class="menu-voice">
          <button
            type="button"
            class="menu-voice__toggle"
            :aria-pressed="autoSpeak"
            @click="setAutoSpeak(!autoSpeak)"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M11 5 6 9H3v6h3l5 4z" />
              <path d="M16 9a4 4 0 0 1 0 6" />
              <path d="M19 6a8 8 0 0 1 0 12" />
            </svg>
            {{ t("chat.autoSpeak") }}
          </button>
          <label class="menu-voice__rate">
            <span>{{ t("chat.speechRate") }}</span>
            <select :value="speechRate" :aria-label="t('chat.speechRate')" @change="onSpeechRate">
              <option v-for="rate in SPEECH_RATES" :key="rate" :value="rate">{{ rate }}×</option>
            </select>
          </label>
        </div>
        <div class="menu-row">
          <LanguageSwitcher />
          <ThemeSwitcher />
          <InstallButton />
        </div>
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
      <ConnectionsView v-if="tab === 'connections'" />
      <ChatView v-else-if="tab === 'chat'" />
      <SessionsView v-else />
    </main>

    <AppFooter v-if="tab !== 'chat'" />
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
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

.topbar-agent {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 auto;
  min-width: 0;
}

.topbar-agent__select {
  width: auto;
  max-width: min(240px, 42vw);
  min-width: 0;
  padding: 4px 8px;
  font-size: 0.82rem;
}

.topbar-agent__protocol {
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--panel-2);
  color: var(--muted);
  font-size: 11px;
  white-space: nowrap;
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

.menu-voice {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 8px 10px;
  border-top: 1px solid var(--border);
}

.menu-voice__toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: start;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  padding: 8px 4px;
  border-radius: 8px;
  cursor: pointer;
}

.menu-voice__toggle[aria-pressed="true"] {
  color: var(--accent);
}

.menu-voice__rate {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 0;
  padding: 0 4px;
  font-size: 0.82rem;
  color: var(--muted);
}

.menu-voice__rate select {
  width: auto;
  padding: 4px 8px;
  font-size: 0.82rem;
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
  flex: 1;
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
}

.content--flush :deep(.chat-panel) {
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  /* Панель не выходит за область контента: иначе при плашке обновления или в
     ландшафте она «лишнюю» высоту отбирала у строк над лентой (резались вкладки). */
  max-height: 100%;
  border: 0;
  border-radius: 0;
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

/* Телефон: хедер остаётся одной строкой — уменьшаем отступы и иконки,
   язык показываем без глобуса и уже, чтобы всё влезло. */
@media (max-width: 480px) {
  .topbar {
    --icon-btn-size: 30px;
    gap: 6px;
    padding: 8px 10px;
  }
  .brand {
    gap: 6px;
  }
  .brand-icon {
    width: 26px;
    height: 26px;
  }
  .brand-name {
    font-size: 0.9rem;
  }
  .brand-sub {
    font-size: 0.6rem;
  }
  .topbar nav {
    gap: 4px;
  }
  .topbar :deep(.theme-btn),
  .topbar :deep(.install-btn) {
    padding: 4px;
  }
}

</style>
