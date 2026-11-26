<script setup lang="ts">
/**
 * «Баланс» — отдельная вкладка: сколько денег у провайдеров и цены моделей.
 * Раньше это жило внизу «Подключений» и мешало настройке агентов.
 */
import { computed, onMounted, ref } from "vue";
import { agents, getAgentKey } from "@/lib/store";
import { describeError } from "@/lib/errors";
import { useLocale } from "@/i18n";
import {
  fetchAccount,
  fetchModelPrices,
  providerProfile,
  readModelPrices,
  readModelPricesAt,
  readSnapshots,
  writeModelPrices,
  writeSnapshot,
  type AccountSnapshot,
} from "@/lib/provider-account";
import { reportSiteClick } from "@/analytics/usage";

const { t, locale } = useLocale();

const accounts = ref<Record<string, AccountSnapshot>>({});
const prices = ref<Record<string, string>>({});
const pricesUpdatedAt = ref(0);
const busy = ref(false);
const error = ref("");

onMounted(() => {
  accounts.value = readSnapshots();
  prices.value = readModelPrices();
  pricesUpdatedAt.value = readModelPricesAt();
});

/** Провайдеры, у которых есть ключ и адрес: только у них бывает баланс. */
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

function priceFor(model: string): string {
  const direct = prices.value[model];
  if (direct) return direct;
  const lower = model.toLowerCase();
  const key = Object.keys(prices.value).find((item) => item.toLowerCase() === lower);
  return key ? prices.value[key] : "";
}

const pricesUpdatedLabel = computed(() =>
  pricesUpdatedAt.value
    ? new Date(pricesUpdatedAt.value).toLocaleString(locale.value, {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "",
);

/** Обновить балансы и цены: по одному запросу на провайдера, ошибки не валят остальные. */
async function refreshBudget(): Promise<void> {
  busy.value = true;
  error.value = "";
  try {
    for (const agent of budgetAgents.value) {
      const key = await getAgentKey(agent);
      if (!key) continue;
      try {
        const facts = await fetchAccount(agent.address, key);
        const snapshot: AccountSnapshot = { agentId: agent.id, fetchedAt: Date.now(), ...facts };
        writeSnapshot(snapshot);
        accounts.value = { ...accounts.value, [agent.id]: snapshot };
      } catch (e) {
        error.value = describeError(e, t);
      }
      try {
        const more = await fetchModelPrices(agent.address, key);
        if (Object.keys(more).length > 0) {
          writeModelPrices(more);
          prices.value = { ...prices.value, ...more };
          pricesUpdatedAt.value = readModelPricesAt();
        }
      } catch {
        // Прайс необязателен: баланс уже записан.
      }
    }
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section>
    <h2>{{ t("balances.title") }}</h2>
    <p class="muted">{{ t("balances.lead") }}</p>

    <div class="agent-head">
      <h3 class="block-title">{{ t("connections.block.prices") }}</h3>
      <span v-if="pricesUpdatedLabel" class="refresh-at">
        {{ t("connections.refreshedAt", { when: pricesUpdatedLabel }) }}
      </span>
      <button
        type="button"
        class="icon-btn"
        :disabled="busy || budgetAgents.length === 0"
        v-tip="busy ? t('connections.refreshing') : t('connections.refresh')"
        :aria-label="busy ? t('connections.refreshing') : t('connections.refresh')"
        @click="refreshBudget"
      >
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          :class="{ spin: busy }"
        >
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
          <path d="M8 16H3v5" />
        </svg>
      </button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

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
              <td class="sheet-price">{{ dash(priceFor(line.model)) }}</td>
              <td>{{ line.limit }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="Object.keys(prices).length === 0" class="muted small">
          {{ t("balances.noPrices") }}
        </p>
      </div>
    </div>

    <div class="card">
      <h3>{{ t("connections.budgetTable") }}</h3>
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
                  @click="reportSiteClick(providerProfile(agent.address).kind)"
                >{{ t("connections.topUp") }}</a>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <p class="muted small">{{ t("balances.note") }}</p>
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
.agent-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.agent-head .block-title {
  margin-bottom: 0;
}
.refresh-at {
  color: var(--muted);
  font-size: 12px;
  margin-left: auto;
}
.sheet-wrap {
  overflow-x: auto;
}
.sheet {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
.sheet th,
.sheet td {
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.sheet-price {
  font-variant-numeric: tabular-nums;
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.small {
  font-size: 12px;
}
</style>
