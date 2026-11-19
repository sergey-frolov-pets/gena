<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import ConnectionsView from "./views/ConnectionsView.vue";
import ChatView from "./views/ChatView.vue";
import SessionsView from "./views/SessionsView.vue";
import LanguageSwitcher from "./components/LanguageSwitcher.vue";
import ThemeSwitcher from "./components/ThemeSwitcher.vue";
import InstallButton from "./components/InstallButton.vue";
import AppFooter from "./components/AppFooter.vue";
import { loadAgents, loadSessions } from "./lib/store";
import { useTheme } from "./lib/theme";
import { useLocale } from "./i18n";

type Tab = "connections" | "chat" | "sessions";
const tab = ref<Tab>("chat");
const { t } = useLocale();
const { theme } = useTheme();
/** Иконка бренда: на тёмной теме — тёмный фон и светло-зелёный логотип. */
const brandIcon = computed(
  () => `${import.meta.env.BASE_URL}icon${theme.value === "dark" ? "-dark" : ""}.svg?v=2`,
);

onMounted(async () => {
  await loadAgents();
  await loadSessions();
});
</script>

<template>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <img class="brand-icon" :src="brandIcon" alt="" aria-hidden="true" />
        <strong>{{ t("app.name") }}</strong>
      </div>
      <nav :aria-label="t('app.nav.main')">
        <button
          type="button"
          class="icon-btn"
          :class="{ primary: tab === 'connections' }"
          :aria-label="t('app.nav.connections')"
          v-tip="t('app.nav.connections')"
          :aria-pressed="tab === 'connections'"
          @click="tab = 'connections'"
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M9 17H7a5 5 0 0 1 0-10h2" />
            <path d="M15 7h2a5 5 0 0 1 0 10h-2" />
            <path d="M8 12h8" />
          </svg>
        </button>
        <button
          type="button"
          class="icon-btn"
          :class="{ primary: tab === 'chat' }"
          :aria-label="t('app.nav.chat')"
          v-tip="t('app.nav.chat')"
          :aria-pressed="tab === 'chat'"
          @click="tab = 'chat'"
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.5 9.5 0 0 1-3.4-.6L3 21l1.7-5a8.4 8.4 0 0 1-.7-3.4 8.4 8.4 0 0 1 8.4-8.4 8.4 8.4 0 0 1 8.6 8.3z" />
          </svg>
        </button>
        <button
          type="button"
          class="icon-btn"
          :class="{ primary: tab === 'sessions' }"
          :aria-label="t('app.nav.sessions')"
          v-tip="t('app.nav.sessions')"
          :aria-pressed="tab === 'sessions'"
          @click="tab = 'sessions'"
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M4 5h16" />
            <path d="M4 12h16" />
            <path d="M4 19h10" />
          </svg>
        </button>
      </nav>
      <LanguageSwitcher />
      <ThemeSwitcher />
      <InstallButton />
    </header>

    <main class="content" :class="{ 'content--flush': tab === 'chat' }">
      <ConnectionsView v-if="tab === 'connections'" />
      <ChatView v-else-if="tab === 'chat'" />
      <SessionsView v-else />
    </main>

    <AppFooter />
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.topbar {
  /* Один размер для иконки бренда и иконочных кнопок навигации. */
  --icon-btn-size: 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  flex-wrap: wrap;
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
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
  height: auto;
  min-height: 0;
  border: 0;
  border-radius: 0;
}
</style>
