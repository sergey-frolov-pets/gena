<script setup lang="ts">
import { computed, ref } from "vue";
import {
  agents,
  createAgent,
  removeAgent,
  updateAgentKey,
  updateAgent,
  getAgentKey,
} from "@/lib/store";
import { checkConnection } from "@/lib/connection-check";
import { describeError } from "@/lib/errors";
import { useLocale } from "@/i18n";
import type { Agent, AgentConfig, Protocol } from "@/storage/types";

const { t } = useLocale();

const name = ref("");
const address = ref("");
const apiKey = ref("");
const contextSize = ref(20);
const callLimit = ref(0);
const llmModel = ref("");
const protocol = ref<Protocol>("http_json");
const model = ref("");
const systemPrompt = ref("");
const error = ref("");
const notice = ref("");

/** id редактируемого агента (null — режим создания). */
const editingId = ref<string | null>(null);
/** Состояние проверки подключения по agentId. */
const testStates = ref<Record<string, { state: "testing" | "ok" | "fail"; msg?: string }>>({});

/** Ключи для повторного ввода при обновлении (по agentId). */
const keyDrafts = ref<Record<string, string>>({});

const formTitle = computed(() =>
  editingId.value ? t("connections.editAgent") : t("connections.newAgent"),
);

const submitLabel = computed(() =>
  editingId.value ? t("connections.saveChanges") : t("connections.add"),
);

const addressLabel = computed(() => {
  if (protocol.value === "openai") return t("connections.field.baseUrl");
  if (protocol.value === "pico_ws") return t("connections.field.wsUrl");
  return t("connections.field.address");
});

const addressPlaceholder = computed(() => {
  if (protocol.value === "openai") return t("connections.field.baseUrlPlaceholder");
  if (protocol.value === "pico_ws") return t("connections.field.wsUrlPlaceholder");
  return t("connections.field.addressPlaceholder");
});

function validateAddress(): string | null {
  const addr = address.value.trim();
  if (!addr) return null;
  let u: URL;
  try {
    u = new URL(addr);
  } catch {
    return t("connections.error.invalidUrl");
  }
  if (protocol.value === "pico_ws") {
    if (u.protocol !== "ws:" && u.protocol !== "wss:") {
      return t("connections.error.invalidUrl");
    }
    if (
      u.protocol === "ws:" &&
      typeof window !== "undefined" &&
      window.location.protocol === "https:"
    ) {
      return t("connections.error.mixedContent");
    }
  } else if (u.protocol !== "http:" && u.protocol !== "https:") {
    return t("connections.error.invalidUrl");
  }
  return null;
}

function resetForm(): void {
  name.value = "";
  address.value = "";
  apiKey.value = "";
  contextSize.value = 20;
  callLimit.value = 0;
  llmModel.value = "";
  model.value = "";
  systemPrompt.value = "";
  protocol.value = "http_json";
  editingId.value = null;
}

function startEdit(agent: Agent): void {
  editingId.value = agent.id;
  name.value = agent.name;
  address.value = agent.address;
  contextSize.value = agent.settings.contextSize;
  callLimit.value = agent.settings.callLimit;
  llmModel.value = agent.settings.llmModel;
  protocol.value = agent.protocol ?? "http_json";
  const cfg = agent.config as { model?: string; systemPrompt?: string } | undefined;
  model.value = cfg?.model ?? "";
  systemPrompt.value = cfg?.systemPrompt ?? "";
  error.value = "";
  notice.value = "";
}

async function submit(): Promise<void> {
  error.value = "";
  notice.value = "";
  if (!name.value.trim() || !address.value.trim()) {
    error.value = t("connections.missingFields");
    return;
  }
  const urlError = validateAddress();
  if (urlError) {
    error.value = urlError;
    return;
  }

  let config: AgentConfig = {};
  if (protocol.value === "openai") {
    config = {
      model: model.value.trim() || llmModel.value.trim(),
      systemPrompt: systemPrompt.value.trim() || undefined,
    };
  } else if (protocol.value === "pico_ws") {
    config = { reconnect: true };
  }

  const settings = {
    contextSize: Number(contextSize.value) || 0,
    callLimit: Number(callLimit.value) || 0,
    llmModel: protocol.value === "http_json" ? llmModel.value.trim() : "",
  };

  try {
    if (editingId.value) {
      await updateAgent(editingId.value, {
        name: name.value.trim(),
        address: address.value.trim(),
        settings,
        protocol: protocol.value,
        config,
      });
      notice.value = t("connections.updated");
    } else {
      await createAgent({
        name: name.value.trim(),
        address: address.value.trim(),
        apiKey: apiKey.value,
        settings,
        protocol: protocol.value,
        config,
      });
      notice.value = t("connections.added");
    }
    resetForm();
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

async function testConnection(agent: Agent): Promise<void> {
  testStates.value[agent.id] = { state: "testing" };
  try {
    const key = await getAgentKey(agent);
    const result = await checkConnection(agent, key);
    if (result.ok) {
      testStates.value[agent.id] = { state: "ok", msg: t("connections.testOk") };
    } else {
      testStates.value[agent.id] = { state: "fail", msg: describeError(result.error, t) };
    }
  } catch (e) {
    testStates.value[agent.id] = { state: "fail", msg: describeError(e, t) };
  }
}

function protocolLabel(agent: { protocol?: Protocol }): string {
  return t(("connections.protocol." + (agent.protocol ?? "http_json")) as never);
}

function agentModel(agent: { settings: { llmModel: string }; config?: AgentConfig }): string {
  const cfg = agent.config as { model?: string } | undefined;
  return cfg?.model || agent.settings.llmModel || "—";
}
</script>

<template>
  <section>
    <h2>{{ t("connections.title") }}</h2>
    <p class="muted">{{ t("connections.intro") }}</p>

    <form class="card" @submit.prevent="submit">
      <h3>{{ formTitle }}</h3>
      <div class="field">
        <label>{{ t("connections.field.name") }}</label>
        <input v-model="name" :placeholder="t('connections.field.namePlaceholder')" />
      </div>

      <div class="field">
        <label>{{ t("connections.protocolLabel") }}</label>
        <select v-model="protocol">
          <option value="http_json">{{ t("connections.protocol.http_json") }}</option>
          <option value="openai">{{ t("connections.protocol.openai") }}</option>
          <option value="pico_ws">{{ t("connections.protocol.pico_ws") }}</option>
        </select>
      </div>

      <div class="field">
        <label>{{ addressLabel }}</label>
        <input v-model="address" :placeholder="addressPlaceholder" />
      </div>

      <div class="field" v-if="!editingId">
        <label>{{ t("connections.field.key") }}</label>
        <input
          v-model="apiKey"
          type="password"
          :placeholder="t('connections.field.keyPlaceholder')"
          autocomplete="off"
        />
      </div>

      <template v-if="protocol === 'openai'">
        <div class="field">
          <label>{{ t("connections.field.llmModel") }}</label>
          <input v-model="model" :placeholder="t('connections.field.llmModelPlaceholder')" />
        </div>
        <div class="field">
          <label>{{ t("connections.field.systemPrompt") }}</label>
          <input v-model="systemPrompt" type="text" />
        </div>
      </template>

      <div class="row">
        <div class="field" v-if="protocol !== 'pico_ws'">
          <label>{{ t("connections.field.contextSize") }}</label>
          <input v-model.number="contextSize" type="number" min="0" />
        </div>
        <div class="field">
          <label>{{ t("connections.field.callLimit") }}</label>
          <input v-model.number="callLimit" type="number" min="0" />
        </div>
        <div class="field" v-if="protocol === 'http_json'">
          <label>{{ t("connections.field.llmModel") }}</label>
          <input v-model="llmModel" :placeholder="t('connections.field.llmModelPlaceholder')" />
        </div>
      </div>

      <p v-if="protocol === 'pico_ws'" class="muted small">
        {{ t("connections.hint.picoContextIgnored") }}
      </p>

      <div class="actions">
        <button class="primary" type="submit">{{ submitLabel }}</button>
        <button v-if="editingId" type="button" @click="resetForm">
          {{ t("connections.cancelEdit") }}
        </button>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="notice" class="ok">{{ notice }}</p>
    </form>

    <h3>{{ t("connections.list") }}</h3>
    <p v-if="agents.length === 0" class="muted">{{ t("connections.empty") }}</p>
    <div v-for="agent in agents" :key="agent.id" class="card">
      <div class="agent-head">
        <strong>{{ agent.name }}</strong>
        <span class="badge">{{ protocolLabel(agent) }}</span>
        <button @click="startEdit(agent)">{{ t("connections.edit") }}</button>
        <button
          :disabled="testStates[agent.id]?.state === 'testing'"
          @click="testConnection(agent)"
        >
          {{
            testStates[agent.id]?.state === "testing"
              ? t("connections.testing")
              : t("connections.test")
          }}
        </button>
        <button class="danger" @click="remove(agent.id)">{{ t("connections.remove") }}</button>
      </div>
      <div class="muted">{{ agent.address }}</div>
      <div class="muted small">
        {{
          t("connections.summary", {
            contextSize: agent.settings.contextSize,
            callLimit: agent.settings.callLimit,
            model: agentModel(agent),
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
      <p
        v-if="testStates[agent.id] && testStates[agent.id].state !== 'testing'"
        class="small"
        :class="testStates[agent.id].state === 'ok' ? 'ok' : 'error'"
      >
        {{ testStates[agent.id].msg }}
      </p>
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
.actions {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-top: 10px;
  flex-wrap: wrap;
}
.agent-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}
.agent-head strong {
  margin-right: auto;
}
.badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  white-space: nowrap;
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
