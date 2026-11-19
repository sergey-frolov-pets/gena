<script setup lang="ts">
import { ref } from "vue";
import { agents, createAgent, removeAgent, updateAgentKey } from "@/lib/store";
import { describeError } from "@/lib/errors";
import { useLocale } from "@/i18n";

const { t } = useLocale();

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
    error.value = t("connections.missingFields");
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
    notice.value = t("connections.added");
  } catch (e) {
    error.value = describeError(e, t);
  }
}

async function saveKey(agentId: string): Promise<void> {
  error.value = "";
  notice.value = "";
  try {
    await updateAgentKey(agentId, keyDrafts.value[agentId] ?? "");
    keyDrafts.value[agentId] = "";
    notice.value = t("connections.keyUpdated");
  } catch (e) {
    error.value = describeError(e, t);
  }
}

async function remove(agentId: string): Promise<void> {
  await removeAgent(agentId);
}
</script>

<template>
  <section>
    <h2>{{ t("connections.title") }}</h2>
    <p class="muted">{{ t("connections.intro") }}</p>

    <form class="card" @submit.prevent="submit">
      <h3>{{ t("connections.newAgent") }}</h3>
      <div class="field">
        <label>{{ t("connections.field.name") }}</label>
        <input v-model="name" :placeholder="t('connections.field.namePlaceholder')" />
      </div>
      <div class="field">
        <label>{{ t("connections.field.address") }}</label>
        <input v-model="address" :placeholder="t('connections.field.addressPlaceholder')" />
      </div>
      <div class="field">
        <label>{{ t("connections.field.key") }}</label>
        <input
          v-model="apiKey"
          type="password"
          :placeholder="t('connections.field.keyPlaceholder')"
          autocomplete="off"
        />
      </div>
      <div class="row">
        <div class="field">
          <label>{{ t("connections.field.contextSize") }}</label>
          <input v-model.number="contextSize" type="number" min="0" />
        </div>
        <div class="field">
          <label>{{ t("connections.field.callLimit") }}</label>
          <input v-model.number="callLimit" type="number" min="0" />
        </div>
        <div class="field">
          <label>{{ t("connections.field.llmModel") }}</label>
          <input v-model="llmModel" :placeholder="t('connections.field.llmModelPlaceholder')" />
        </div>
      </div>
      <button class="primary" type="submit">{{ t("connections.add") }}</button>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="notice" class="ok">{{ notice }}</p>
    </form>

    <h3>{{ t("connections.list") }}</h3>
    <p v-if="agents.length === 0" class="muted">{{ t("connections.empty") }}</p>
    <div v-for="agent in agents" :key="agent.id" class="card">
      <div class="agent-head">
        <strong>{{ agent.name }}</strong>
        <button class="danger" @click="remove(agent.id)">{{ t("connections.remove") }}</button>
      </div>
      <div class="muted">{{ agent.address }}</div>
      <div class="muted small">
        {{
          t("connections.summary", {
            contextSize: agent.settings.contextSize,
            callLimit: agent.settings.callLimit,
            model: agent.settings.llmModel || "—",
          })
        }}
      </div>
      <div class="key-row">
        <input
          v-model="keyDrafts[agent.id]"
          type="password"
          :placeholder="
            agent.sealedKey ? t('connections.keySaved') : t('connections.keyMissing')
          "
          autocomplete="off"
        />
        <button @click="saveKey(agent.id)">{{ t("connections.saveKey") }}</button>
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
