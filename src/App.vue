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
import { watchForUpdate } from "./lib/version-update";
import { useLocale } from "./i18n";

type Tab = "connections" | "chat" | "sessions";
const tab = ref<Tab>("chat");
const { t } = useLocale();
const { theme } = useTheme();
/** Плашка «доступна новая версия»: ставится, когда SW перешёл на новую сборку. */
const updateReady = ref(false);
watchForUpdate(() => {
  updateReady.value = true;
});
function applyUpdate(): void {
  window.location.reload();
}
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
        <div class="brand-text">
          <strong class="brand-name">{{ t("app.name") }}</strong>
          <span class="brand-sub">AI chat</span>
        </div>
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
  gap: 12px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  /* Все элементы хедера — в одну строку: на телефоне сжимаем, а не переносим. */
  flex-wrap: nowrap;
  min-width: 0;
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

/* Совсем узкий экран: подпись бренда убираем, имя оставляем. */
@media (max-width: 359px) {
  .brand-sub {
    display: none;
  }
}
</style>
