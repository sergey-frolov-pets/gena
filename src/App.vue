<script setup lang="ts">
import { onMounted, ref } from "vue";
import ConnectionsView from "./views/ConnectionsView.vue";
import ChatView from "./views/ChatView.vue";
import SessionsView from "./views/SessionsView.vue";
import { loadAgents, loadSessions } from "./lib/store";

type Tab = "connections" | "chat" | "sessions";
const tab = ref<Tab>("connections");

onMounted(async () => {
  await loadAgents();
  await loadSessions();
});
</script>

<template>
  <div class="app">
    <header class="topbar">
      <strong>Gena</strong>
      <nav>
        <button :class="{ primary: tab === 'connections' }" @click="tab = 'connections'">
          Подключения
        </button>
        <button :class="{ primary: tab === 'chat' }" @click="tab = 'chat'">Чат</button>
        <button :class="{ primary: tab === 'sessions' }" @click="tab = 'sessions'">
          Сессии
        </button>
      </nav>
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
