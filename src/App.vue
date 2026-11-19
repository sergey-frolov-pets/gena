<script setup lang="ts">
import { onMounted, ref } from "vue";
import ConnectionsView from "./views/ConnectionsView.vue";
import ChatView from "./views/ChatView.vue";
import SessionsView from "./views/SessionsView.vue";
import LanguageSwitcher from "./components/LanguageSwitcher.vue";
import { loadAgents, loadSessions } from "./lib/store";
import { useLocale } from "./i18n";

type Tab = "connections" | "chat" | "sessions";
const tab = ref<Tab>("connections");
const { t } = useLocale();

onMounted(async () => {
  await loadAgents();
  await loadSessions();
});
</script>

<template>
  <div class="app">
    <header class="topbar">
      <strong>{{ t("app.name") }}</strong>
      <nav :aria-label="t('app.nav.main')">
        <button :class="{ primary: tab === 'connections' }" @click="tab = 'connections'">
          {{ t("app.nav.connections") }}
        </button>
        <button :class="{ primary: tab === 'chat' }" @click="tab = 'chat'">
          {{ t("app.nav.chat") }}
        </button>
        <button :class="{ primary: tab === 'sessions' }" @click="tab = 'sessions'">
          {{ t("app.nav.sessions") }}
        </button>
      </nav>
      <LanguageSwitcher />
    </header>

    <main class="content">
      <ConnectionsView v-if="tab === 'connections'" />
      <ChatView v-else-if="tab === 'chat'" />
      <SessionsView v-else />
    </main>
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  flex-wrap: wrap;
}

.topbar nav {
  display: flex;
  gap: 8px;
}

.content {
  flex: 1;
  padding: 20px;
  max-width: 960px;
  width: 100%;
  margin: 0 auto;
}
</style>
