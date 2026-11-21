<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  agents,
  createAgent,
  removeAgent,
  updateAgentKey,
  updateAgent,
  getAgentKey,
} from "@/lib/store";
import { checkConnection } from "@/lib/connection-check";
import { validateAgentDraft, type AgentFormError } from "@/lib/agent-form";
import { describeError } from "@/lib/errors";
import { useLocale } from "@/i18n";
import {
  MAX_QUICK_REPLIES,
  normalizeQuickReplies,
  type Agent,
  type AgentConfig,
  type Protocol,
} from "@/storage/types";
import ConfirmModal from "@/components/ConfirmModal.vue";
import {
  fetchAccount,
  fetchModelPrices,
  providerProfile,
  readSnapshots,
  writeSnapshot,
  type AccountSnapshot,
} from "@/lib/provider-account";

const { t } = useLocale();

const name = ref("");
const address = ref("");
const apiKey = ref("");
const contextSize = ref(20);
const callLimit = ref(0);
const llmModel = ref("");
/** Стандартные сообщения: textarea, одна строка — одна кнопка. */
const quickRepliesText = ref("");
/** Агент, у которого берём готовый набор стандартных сообщений. */
const importFromId = ref("");
const protocol = ref<Protocol>("http_json");
const model = ref("");
const systemPrompt = ref("");
const preferFree = ref(false);
const poolModels = ref<{ id: string; free: boolean; dailyLimit: number }[]>([]);
const mixRoutes = ref<{ agentId: string; model: string }[]>([]);
const error = ref("");
const notice = ref("");
const accounts = ref<Record<string, AccountSnapshot>>({});
const prices = ref<Record<string, string>>({});
const budgetBusy = ref(false);

onMounted(() => {
  accounts.value = readSnapshots();
});

/** Агент, у которого подтверждаем удаление. */
const confirmRemoveId = ref("");
const confirmRemoveAgent = computed(() =>
  agents.value.find((agent) => agent.id === confirmRemoveId.value),
);

/** id редактируемого агента (null — режим создания). */
const editingId = ref<string | null>(null);
/** Состояние проверки подключения по agentId. */
const testStates = ref<Record<string, { state: "testing" | "ok" | "fail"; msg?: string }>>({});

/** Ключи для повторного ввода при обновлении (по agentId). */
const keyDrafts = ref<Record<string, string>>({});

/** Агенты с готовым набором стандартных сообщений (кроме редактируемого). */
const agentsWithQuick = computed(() =>
  agents.value.filter(
    (agent) =>
      agent.id !== editingId.value && (agent.settings.quickReplies?.length ?? 0) > 0,
  ),
);

/** Сколько строк реально сохранится — для подсказки под полем. */
const quickRepliesCount = computed(() => normalizeQuickReplies(quickRepliesText.value).length);

const formTitle = computed(() =>
  editingId.value ? t("connections.editAgent") : t("connections.newAgent"),
);

const submitLabel = computed(() =>
  editingId.value ? t("connections.saveChanges") : t("connections.add"),
);

const savedProviders = computed(() =>
  agents.value.filter(
    (agent) =>
      agent.id !== editingId.value &&
      (agent.protocol === "openai" || agent.protocol === "model_pool"),
  ),
);

function providerModels(agentId: string): string[] {
  const provider = agents.value.find((agent) => agent.id === agentId);
  if (!provider) return [];
  if (provider.protocol === "openai") {
    const own =
      (provider.config as { model?: string } | undefined)?.model || provider.settings.llmModel;
    return own.trim() ? [own.trim()] : [];
  }
  const models = (provider.config as { models?: { id?: string }[] } | undefined)?.models ?? [];
  return models.map((item) => String(item.id ?? "").trim()).filter(Boolean);
}

const addressLabel = computed(() => {
  if (protocol.value === "openai" || protocol.value === "model_pool") return t("connections.field.baseUrl");
  if (protocol.value === "pico_ws") return t("connections.field.wsUrl");
  return t("connections.field.address");
});

const addressPlaceholder = computed(() => {
  if (protocol.value === "openai" || protocol.value === "model_pool") return t("connections.field.baseUrlPlaceholder");
  if (protocol.value === "pico_ws") return t("connections.field.wsUrlPlaceholder");
  return t("connections.field.addressPlaceholder");
});

function resetForm(): void {
  name.value = "";
  address.value = "";
  apiKey.value = "";
  contextSize.value = 20;
  callLimit.value = 0;
  llmModel.value = "";
  quickRepliesText.value = "";
  importFromId.value = "";
  model.value = "";
  systemPrompt.value = "";
  preferFree.value = false;
  poolModels.value = [];
  mixRoutes.value = [];
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
  quickRepliesText.value = (agent.settings.quickReplies ?? []).join("\n");
  importFromId.value = "";
  protocol.value = agent.protocol ?? "http_json";
  const cfg = agent.config as {
    model?: string;
    systemPrompt?: string;
    preferFree?: boolean;
    models?: { id?: string; free?: boolean; dailyLimit?: number }[];
    routes?: { agentId?: string; model?: string }[];
  } | undefined;
  model.value = cfg?.model ?? "";
  systemPrompt.value = cfg?.systemPrompt ?? "";
  preferFree.value = Boolean(cfg?.preferFree);
  poolModels.value = (cfg?.models ?? []).map((item) => ({
    id: String(item.id ?? ""),
    free: Boolean(item.free),
    dailyLimit: Number(item.dailyLimit) || 0,
  }));
  mixRoutes.value = (cfg?.routes ?? []).map((item) => ({
    agentId: String(item.agentId ?? ""),
    model: String(item.model ?? ""),
  }));
  error.value = "";
  notice.value = "";
}

/** Текст ошибки формы по коду проверки — без сырых сообщений из браузера. */
function formErrorText(errors: AgentFormError[]): string {
  if (errors.includes("addressMixed")) return t("connections.error.mixedContent");
  if (errors.includes("addressInvalid")) return t("connections.error.invalidUrl");
  return t("connections.missingFields");
}

async function submit(): Promise<void> {
  error.value = "";
  notice.value = "";
  const checked = validateAgentDraft(
    {
      name: name.value,
      address: address.value,
      contextSize: contextSize.value,
      callLimit: callLimit.value,
      llmModel: llmModel.value,
    },
    { protocol: protocol.value },
  );
  if (!checked.ok) {
    error.value = formErrorText(checked.errors);
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
  } else if (protocol.value === "model_pool") {
    const models = poolModels.value
      .map((item) => ({
        id: item.id.trim(),
        free: item.free,
        dailyLimit: Math.max(0, Math.round(Number(item.dailyLimit) || 0)),
      }))
      .filter((item) => item.id);
    if (models.length === 0) {
      error.value = t("connections.error.modelsEmpty");
      return;
    }
    config = {
      models,
      preferFree: preferFree.value,
      systemPrompt: systemPrompt.value.trim() || undefined,
    };
  } else if (protocol.value === "model_mix") {
    const routes = mixRoutes.value.filter((item) => item.agentId && item.model.trim());
    if (routes.length === 0) {
      error.value = t("connections.error.routesEmpty");
      return;
    }
    config = { routes, preferFree: preferFree.value };
  }

  const settings = {
    ...checked.values.settings,
    llmModel: protocol.value === "http_json" ? checked.values.settings.llmModel : "",
    quickReplies: normalizeQuickReplies(quickRepliesText.value),
  };

  try {
    if (editingId.value) {
      await updateAgent(editingId.value, {
        name: checked.values.name,
        address: protocol.value === "model_mix" ? "" : checked.values.address,
        settings,
        protocol: protocol.value,
        config,
      });
      notice.value = t("connections.updated");
    } else {
      const created = await createAgent({
        name: checked.values.name,
        address: protocol.value === "model_mix" ? "" : checked.values.address,
        apiKey: apiKey.value,
        settings,
        protocol: protocol.value,
        config,
      });
      if (apiKey.value && created.address) {
        await rememberAccount(created.id, created.address, apiKey.value);
      }
      notice.value = t("connections.added");
    }
    resetForm();
  } catch (e) {
    error.value = describeError(e, t);
  }
}

/** Взять стандартные сообщения у другого агента. */
function takeQuickReplies(): void {
  const source = agents.value.find((agent) => agent.id === importFromId.value);
  if (!source) return;
  const list = source.settings.quickReplies ?? [];
  if (list.length === 0) return;
  quickRepliesText.value = list.join("\n");
  notice.value = t("connections.quickImportDone", { name: source.name, count: list.length });
}

async function rememberAccount(agentId: string, address: string, apiKey: string): Promise<void> {
  try {
    const facts = await fetchAccount(address, apiKey);
    const snapshot: AccountSnapshot = { agentId, fetchedAt: Date.now(), ...facts };
    writeSnapshot(snapshot);
    accounts.value = { ...accounts.value, [agentId]: snapshot };
    const more = await fetchModelPrices(address, apiKey);
    prices.value = { ...prices.value, ...more };
  } catch {
    // Ключ уже сохранён: пустой баланс не откатывает его.
  }
}

async function saveKey(agentId: string): Promise<void> {
  error.value = "";
  notice.value = "";
  const next = keyDrafts.value[agentId] ?? "";
  try {
    await updateAgentKey(agentId, next);
    keyDrafts.value[agentId] = "";
    const agent = agents.value.find((item) => item.id === agentId);
    if (agent?.address && next) await rememberAccount(agent.id, agent.address, next);
    notice.value = t("connections.keyUpdated");
  } catch (e) {
    error.value = describeError(e, t);
  }
}

const budgetAgents = computed(() =>
  agents.value.filter(
    (agent) =>
      (agent.protocol === "openai" || agent.protocol === "model_pool") &&
      Boolean(agent.sealedKey) &&
      Boolean(agent.address),
  ),
);

const modelLines = computed(() => {
  const lines: { key: string; provider: string; model: string; limit: string }[] = [];
  for (const agent of agents.value) {
    if (agent.protocol === "openai") {
      const modelId = (
        (agent.config as { model?: string } | undefined)?.model || agent.settings.llmModel
      ).trim();
      if (!modelId) continue;
      lines.push({
        key: `${agent.id}:${modelId}`,
        provider: agent.name,
        model: modelId,
        limit: limitLabel(false, agent.settings.callLimit),
      });
    }
    if (agent.protocol === "model_pool") {
      const models =
        (agent.config as { models?: { id?: string; free?: boolean; dailyLimit?: number }[] } | undefined)
          ?.models ?? [];
      for (const item of models) {
        const modelId = String(item.id ?? "").trim();
        if (!modelId) continue;
        lines.push({
          key: `${agent.id}:${modelId}`,
          provider: agent.name,
          model: modelId,
          limit: limitLabel(Boolean(item.free), Number(item.dailyLimit) || 0),
        });
      }
    }
  }
  return lines;
});

function limitLabel(free: boolean, daily: number): string {
  const cap = daily > 0 ? t("connections.limitPerDay", { n: daily }) : t("connections.limitNone");
  return free ? `${t("connections.limitFree")} · ${cap}` : cap;
}

function dash(value: string): string {
  return value || t("connections.unknown");
}

async function refreshBudget(): Promise<void> {
  budgetBusy.value = true;
  error.value = "";
  try {
    for (const agent of budgetAgents.value) {
      const key = await getAgentKey(agent);
      if (key) await rememberAccount(agent.id, agent.address, key);
    }
  } catch (e) {
    error.value = describeError(e, t);
  } finally {
    budgetBusy.value = false;
  }
}

async function remove(agentId: string): Promise<void> {
  confirmRemoveId.value = "";
  await removeAgent(agentId);
}

async function testConnection(agent: Agent): Promise<void> {
  testStates.value[agent.id] = { state: "testing" };
  try {
    if (agent.protocol === "model_mix") {
      const route = (
        (agent.config as { routes?: { agentId: string; model: string }[] } | undefined)?.routes ?? []
      )[0];
      const provider = route && agents.value.find((item) => item.id === route.agentId);
      if (!provider || !route) {
        testStates.value[agent.id] = { state: "fail", msg: t("connections.error.routesEmpty") };
        return;
      }
      const key = await getAgentKey(provider);
      const result = await checkConnection(
        { ...provider, protocol: "openai", config: { model: route.model } },
        key,
      );
      testStates.value[agent.id] = result.ok
        ? { state: "ok", msg: t("connections.testOk") }
        : { state: "fail", msg: describeError(result.error, t) };
      return;
    }
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

function agentModel(agent: { settings: { llmModel: string }; config?: AgentConfig; protocol?: Protocol }): string {
  const cfg = agent.config as { model?: string; models?: unknown[]; routes?: unknown[] } | undefined;
  if (agent.protocol === "model_pool") return String(cfg?.models?.length ?? 0);
  if (agent.protocol === "model_mix") return String(cfg?.routes?.length ?? 0);
  return cfg?.model || agent.settings.llmModel || "—";
}

function moveRow<T>(list: T[], index: number, delta: number): void {
  const next = index + delta;
  if (next < 0 || next >= list.length) return;
  const [item] = list.splice(index, 1);
  if (item !== undefined) list.splice(next, 0, item);
}

function addPoolModel(): void {
  poolModels.value.push({ id: "", free: false, dailyLimit: 0 });
}

function addMixRoute(): void {
  const provider = savedProviders.value[0];
  mixRoutes.value.push({
    agentId: provider?.id ?? "",
    model: provider ? (providerModels(provider.id)[0] ?? "") : "",
  });
}
</script>

<template>
  <section>
    <h2>{{ t("connections.title") }}</h2>
    <p class="muted">{{ t("connections.intro") }}</p>

    <form class="card" @submit.prevent="submit">
      <h3>{{ formTitle }}</h3>
      <div class="pair">
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
          <option value="model_pool">{{ t("connections.protocol.model_pool") }}</option>
          <option value="model_mix">{{ t("connections.protocol.model_mix") }}</option>
          </select>
        </div>
      </div>

      <div class="pair" v-if="protocol !== 'model_mix'">
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
      </div>

      <template v-if="protocol === 'openai'">
        <div class="field">
          <label>{{ t("connections.field.llmModel") }}</label>
          <input v-model="model" :placeholder="t('connections.field.llmModelPlaceholder')" />
        </div>
      </template>

      <template v-if="protocol === 'model_pool'">
        <div class="field">
          <label>{{ t("connections.field.models") }}</label>
          <div v-for="(row, index) in poolModels" :key="index" class="model-row">
            <input v-model="row.id" :placeholder="t('connections.field.llmModelPlaceholder')" />
            <label class="check">
              <input v-model="row.free" type="checkbox" />
              {{ t("connections.field.free") }}
            </label>
            <input v-model.number="row.dailyLimit" type="number" min="0" />
            <button type="button" :disabled="index === 0" @click="moveRow(poolModels, index, -1)">↑</button>
            <button type="button" :disabled="index === poolModels.length - 1" @click="moveRow(poolModels, index, 1)">↓</button>
            <button type="button" @click="poolModels.splice(index, 1)">{{ t("connections.removeRow") }}</button>
          </div>
          <button type="button" @click="addPoolModel">{{ t("connections.addModel") }}</button>
          <p class="muted small">{{ t("connections.hint.pool") }}</p>
        </div>
        <label class="check">
          <input v-model="preferFree" type="checkbox" />
          {{ t("connections.preferFree") }}
        </label>
      </template>

      <template v-if="protocol === 'model_mix'">
        <div class="field">
          <label>{{ t("connections.field.routes") }}</label>
          <div v-for="(row, index) in mixRoutes" :key="index" class="model-row">
            <select v-model="row.agentId" @change="row.model = providerModels(row.agentId)[0] ?? ''">
              <option value="">{{ t("connections.field.provider") }}</option>
              <option v-for="provider in savedProviders" :key="provider.id" :value="provider.id">
                {{ provider.name }}
              </option>
            </select>
            <select v-model="row.model">
              <option v-for="modelId in providerModels(row.agentId)" :key="modelId" :value="modelId">
                {{ modelId }}
              </option>
            </select>
            <button type="button" :disabled="index === 0" @click="moveRow(mixRoutes, index, -1)">↑</button>
            <button type="button" :disabled="index === mixRoutes.length - 1" @click="moveRow(mixRoutes, index, 1)">↓</button>
            <button type="button" @click="mixRoutes.splice(index, 1)">{{ t("connections.removeRow") }}</button>
          </div>
          <button type="button" :disabled="savedProviders.length === 0" @click="addMixRoute">
            {{ t("connections.addRoute") }}
          </button>
          <p class="muted small">{{ t("connections.hint.mix") }}</p>
        </div>
        <label class="check">
          <input v-model="preferFree" type="checkbox" />
          {{ t("connections.preferFree") }}
        </label>
      </template>

      <div class="row">
        <div class="field" v-if="protocol !== 'pico_ws'">
          <label>{{ t("connections.field.contextSize") }}</label>
          <input v-model.number="contextSize" type="number" min="0" />
        </div>
        <div class="field" v-if="protocol !== 'model_pool' && protocol !== 'model_mix'">
          <label>{{ t("connections.field.callLimit") }}</label>
          <input v-model.number="callLimit" type="number" min="0" />
        </div>
        <div class="field" v-if="protocol === 'http_json'">
          <label>{{ t("connections.field.llmModel") }}</label>
          <input v-model="llmModel" :placeholder="t('connections.field.llmModelPlaceholder')" />
        </div>
      </div>

      <details class="extras">
        <summary>{{ t("connections.extras") }}</summary>
        <div v-if="protocol === 'openai' || protocol === 'model_pool'" class="field">
          <label>{{ t("connections.field.systemPrompt") }}</label>
          <input v-model="systemPrompt" type="text" />
        </div>
        <div class="field">
          <label>{{ t("connections.field.quickReplies") }}</label>
          <textarea
            v-model="quickRepliesText"
            rows="3"
            :placeholder="t('connections.field.quickRepliesPlaceholder')"
          ></textarea>
          <p class="muted small">
            {{ t("connections.quickRepliesNote", { count: quickRepliesCount, max: MAX_QUICK_REPLIES }) }}
          </p>
        </div>

      <div v-if="agentsWithQuick.length > 0" class="field">
        <label>{{ t("connections.quickImport") }}</label>
        <div class="key-row">
          <select v-model="importFromId">
            <option value="">{{ t("connections.quickImportPick") }}</option>
            <option v-for="other in agentsWithQuick" :key="other.id" :value="other.id">
              {{ other.name }}
            </option>
          </select>
          <button type="button" :disabled="!importFromId" @click="takeQuickReplies">
            {{ t("connections.quickImportTake") }}
          </button>
        </div>
      </div>
      </details>

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
        <button class="danger" @click="confirmRemoveId = agent.id">{{ t("connections.remove") }}</button>
      </div>
      <div v-if="agent.address" class="muted">{{ agent.address }}</div>
      <div class="muted small">
        {{
          t("connections.summary", {
            contextSize: agent.settings.contextSize,
            callLimit: agent.settings.callLimit,
            model: agentModel(agent),
          })
        }}
      </div>
      <details v-if="agent.protocol !== 'model_mix'" class="extras">
        <summary>{{ t("connections.updateKey") }}</summary>
        <p v-if="accounts[agent.id]?.expiresAt" class="muted small">
          {{ t("connections.col.expires") }}: {{ accounts[agent.id].expiresAt }}
        </p>
        <div class="key-row">
          <input
            v-model="keyDrafts[agent.id]"
            type="password"
            :placeholder="agent.sealedKey ? t('connections.keySaved') : t('connections.keyMissing')"
            autocomplete="off"
          />
          <button type="button" @click="saveKey(agent.id)">{{ t("connections.updateKey") }}</button>
        </div>
      </details>
      <p
        v-if="testStates[agent.id] && testStates[agent.id].state !== 'testing'"
        class="small"
        :class="testStates[agent.id].state === 'ok' ? 'ok' : 'error'"
      >
        {{ testStates[agent.id].msg }}
      </p>
    </div>
    <div class="card">
      <h3>{{ t("connections.modelsTable") }}</h3>
      <p v-if="modelLines.length === 0" class="muted">{{ t("connections.modelsEmptyTable") }}</p>
      <div v-else class="sheet-wrap">
        <table class="sheet">
          <thead>
            <tr>
              <th>{{ t("connections.col.provider") }}</th>
              <th>{{ t("connections.col.model") }}</th>
              <th>{{ t("connections.col.price") }}</th>
              <th>{{ t("connections.col.limits") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="line in modelLines" :key="line.key">
              <td>{{ line.provider }}</td>
              <td>{{ line.model }}</td>
              <td>{{ dash(prices[line.model] ?? "") }}</td>
              <td>{{ line.limit }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="agent-head">
        <h3>{{ t("connections.budgetTable") }}</h3>
        <button type="button" :disabled="budgetBusy || budgetAgents.length === 0" @click="refreshBudget">
          {{ budgetBusy ? t("connections.refreshing") : t("connections.refresh") }}
        </button>
      </div>
      <p v-if="budgetAgents.length === 0" class="muted">{{ t("connections.budgetEmpty") }}</p>
      <div v-else class="sheet-wrap">
        <table class="sheet">
          <thead>
            <tr>
              <th>{{ t("connections.col.provider") }}</th>
              <th>{{ t("connections.col.money") }}</th>
              <th>{{ t("connections.col.freeLimits") }}</th>
              <th>{{ t("connections.col.expires") }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="agent in budgetAgents" :key="agent.id">
              <td>{{ agent.name }}</td>
              <td>{{ dash(accounts[agent.id]?.money ?? "") }}</td>
              <td>{{ dash(accounts[agent.id]?.free ?? "") }}</td>
              <td>{{ dash(accounts[agent.id]?.expiresAt ?? "") }}</td>
              <td>
                <a
                  v-if="providerProfile(agent.address).topUpUrl"
                  :href="providerProfile(agent.address).topUpUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                >{{ t("connections.topUp") }}</a>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <ConfirmModal
      :open="Boolean(confirmRemoveAgent)"
      :title="t('connections.removeConfirmTitle')"
      :message="
        confirmRemoveAgent
          ? t('connections.removeConfirmText', { name: confirmRemoveAgent.name })
          : ''
      "
      :confirm-label="t('connections.remove')"
      :cancel-label="t('chat.cancel')"
      @confirm="confirmRemoveAgent && remove(confirmRemoveAgent.id); confirmRemoveId = ''"
      @cancel="confirmRemoveId = ''"
    />
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
.row,
.pair {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.row {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
@media (max-width: 720px) {
  .row,
  .pair {
    grid-template-columns: 1fr;
  }
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
.model-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.model-row input,
.model-row select {
  flex: 1;
  min-width: 8rem;
}
.check {
  display: flex;
  gap: 6px;
  align-items: center;
  margin: 8px 0;
}
.extras {
  margin-top: 8px;
}
.extras summary {
  cursor: pointer;
  color: var(--muted, #8b93a1);
  font-size: 13px;
}
.sheet-wrap {
  overflow-x: auto;
}
.sheet {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.sheet th,
.sheet td {
  text-align: start;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.sheet h3,
.card h3 {
  margin: 0;
}
.agent-head h3 {
  margin-right: auto;
}
</style>
