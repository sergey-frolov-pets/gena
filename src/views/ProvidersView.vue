<script setup lang="ts">
import { connectableProviders } from "@/lib/providers";
import { useLocale } from "@/i18n";

const { t } = useLocale();
</script>

<template>
  <article class="providers">
    <h1>{{ t("providers.title") }}</h1>
    <p class="providers__lead">{{ t("providers.lead") }}</p>
    <p class="providers__note">{{ t("providers.cors") }}</p>

    <ul>
      <li v-for="provider in connectableProviders" :key="provider.id">
        <div class="providers__head">
          <strong>{{ provider.name }}</strong>
          <a :href="provider.site" target="_blank" rel="noopener noreferrer">
            {{ t("providers.openSite") }}
          </a>
        </div>
        <p>{{ t(("providers.hint." + provider.hint) as "providers.hint.cloud") }}</p>
        <p class="providers__base">
          <span>{{ t("providers.baseLabel") }}</span>
          <code>{{ provider.baseUrl }}</code>
        </p>
      </li>
    </ul>
  </article>
</template>

<style scoped>
.providers {
  max-width: 42rem;
}

.providers h1 {
  margin: 0 0 8px;
  font-size: 1.4rem;
}

.providers__lead,
.providers__note,
.providers li p {
  margin: 0;
  line-height: 1.5;
}

.providers__lead,
.providers__note {
  color: var(--muted);
}

.providers__note {
  margin-top: 8px;
}

.providers ul {
  list-style: none;
  margin: 16px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.providers li {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--panel);
}

.providers__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.providers__head a {
  color: var(--accent);
  font-size: 0.88rem;
}

.providers__base {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: baseline;
  color: var(--muted);
  font-size: 0.85rem;
}

.providers code {
  color: inherit;
  word-break: break-all;
}
</style>
