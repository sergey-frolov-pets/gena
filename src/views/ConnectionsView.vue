<script setup lang="ts">
import { ref } from "vue";
import { agents, createAgent, removeAgent, updateAgentKey } from "@/lib/store";
import { describeError } from "@/lib/errors";

const name = ref("");
const address = ref("");
const apiKey = ref("");
const contextSize = ref(20);
const callLimit = ref(0);
const llmModel = ref("");
const error = ref("");
const notice = ref("");

/** Ключи для повторного ввода при обновлении (по agentId). */
const keyDrafts = ref<Record<string, string>>({});

async function submit(): Promise<void> {
  error.value = "";
  notice.value = "";
  if (!name.value.trim() || !address.value.trim()) {
    error.value = "Укажите имя и адрес агента";
    return;
  }
  try {
    await createAgent({
      name: name.value.trim(),
      address: address.value.trim(),
      apiKey: apiKey.value,
      settings: {
        contextSize: Number(contextSize.value) || 0,
        callLimit: Number(callLimit.value) || 0,
        llmModel: llmModel.value.trim(),
      },
    });
    name.value = "";
    address.value = "";
    apiKey.value = "";
    contextSize.value = 20;
    callLimit.value = 0;
    llmModel.value = "";
    notice.value = "Агент добавлен";
  } catch (e) {
    error.value = describeError(e);
  }
}

async function saveKey(agentId: string): Promise<void> {
  error.value = "";
  notice.value = "";
  try {
    await updateAgentKey(agentId, keyDrafts.value[agentId] ?? "");
    keyDrafts.value[agentId] = "";
    notice.value = "Ключ обновлён";
  } catch (e) {
    error.value = describeError(e);
  }
}

async function remove(agentId: string): Promise<void> {
  await removeAgent(agentId);
}
</script>

<template>
  <section>
    <h2>Подключения к агентам</h2>
    <p class="muted">
      Ключ агента хранится в браузере зашифрованным (AES-GCM, ключ на устройстве).
      В бэкап ключи не попадают.
    </p>

    <form class="card" @submit.prevent="submit">
      <h3>Новый агент</h3>
      <div class="field">
        <label>Имя</label>
        <input v-model="name" placeholder="Мой агент" />
      </div>
      <div class="field">
        <label>Адрес (URL endpoint)</label>
        <input v-model="address" placeholder="https://agent.example.com/chat" />
      </div>
      <div class="field">
        <label>Ключ (Bearer token)</label>
        <input v-model="apiKey" type="password" placeholder="секрет" autocomplete="off" />
      </div>
      <div class="row">
        <div class="field">
          <label>Размер контекста (сообщений)</label>
          <input v-model.number="contextSize" type="number" min="0" />
        </div>
        <div class="field">
          <label>Лимит вызовов в сутки (0 — без лимита)</label>
          <input v-model.number="callLimit" type="number" min="0" />
        </div>
        <div class="field">
          <label>LLM-модель</label>
          <input v-model="llmModel" placeholder="напр. gpt-4o-mini" />
        </div>
      </div>
      <button class="primary" type="submit">Добавить</button>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="notice" class="ok">{{ notice }}</p>
    </form>

    <h3>Список агентов</h3>
    <p v-if="agents.length === 0" class="muted">Пока нет агентов.</p>
    <div v-for="agent in agents" :key="agent.id" class="card">
      <div class="agent-head">
        <strong>{{ agent.name }}</strong>
        <button class="danger" @click="remove(agent.id)">Удалить</button>
      </div>
      <div class="muted">{{ agent.address }}</div>
      <div class="muted small">
        контекст: {{ agent.settings.contextSize }} · лимит/сутки: {{ agent.settings.callLimit }} ·
        модель: {{ agent.settings.llmModel || "—" }}
      </div>
      <div class="key-row">
        <input
          v-model="keyDrafts[agent.id]"
          type="password"
          :placeholder="agent.sealedKey ? 'ключ сохранён — введите новый, чтобы заменить' : 'ключ не задан'"
          autocomplete="off"
        />
        <button @click="saveKey(agent.id)">Сохранить ключ</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
}
.row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.agent-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}
.small {
  font-size: 12px;
}
.key-row {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.key-row input {
  flex: 1;
}
</style>
