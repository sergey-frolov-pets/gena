<script setup lang="ts">
import { useLocale } from "@/i18n";
import type { LocaleKey } from "@/i18n/types";

const { t } = useLocale();

const setupSteps: LocaleKey[] = [
  "about.setup.1",
  "about.setup.2",
  "about.setup.3",
  "about.setup.4",
  "about.setup.5",
];

const useSteps: LocaleKey[] = [
  "about.use.1",
  "about.use.2",
  "about.use.3",
  "about.use.4",
];
</script>

<template>
  <article class="about">
    <h1>{{ t("about.title") }}</h1>
    <p class="about__lead">{{ t("about.lead") }}</p>

    <section>
      <h2>{{ t("about.setup.title") }}</h2>
      <ol>
        <li v-for="key in setupSteps" :key="key">{{ t(key) }}</li>
      </ol>
    </section>

    <section>
      <h2>{{ t("about.use.title") }}</h2>
      <ol>
        <li v-for="key in useSteps" :key="key">{{ t(key) }}</li>
      </ol>
    </section>
  </article>
</template>

<style scoped>
.about {
  max-width: 42rem;
}

.about h1 {
  margin: 0 0 8px;
  font-size: 1.4rem;
}

.about h2 {
  margin: 1.4rem 0 0.4rem;
  font-size: 1.05rem;
}

.about__lead {
  margin: 0;
  color: var(--muted);
  line-height: 1.5;
}

.about ol {
  margin: 0;
  padding-inline-start: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 8px;
  line-height: 1.45;
}
</style>
