<script setup lang="ts">
import { ref } from "vue";
import { useLocale } from "@/i18n";
import type { LocaleKey } from "@/i18n/types";
import { connectableAgents, connectableProviders } from "@/lib/providers";

const { t } = useLocale();
const base = import.meta.env.BASE_URL;
const copied = ref(false);

const features: LocaleKey[] = [
  "about.features.1",
  "about.features.2",
  "about.features.3",
  "about.features.4",
  "about.features.5",
  "about.features.6",
];

const quick: LocaleKey[] = ["about.quick.1", "about.quick.2", "about.quick.3", "about.quick.4"];

const sections: { title: LocaleKey; body: LocaleKey; image: string; caption: LocaleKey }[] = [
  {
    title: "about.menu.title",
    body: "about.menu.body",
    image: "guide/menu.png",
    caption: "about.fig.menu",
  },
  {
    title: "about.chat.title",
    body: "about.chat.body",
    image: "guide/chat.png",
    caption: "about.fig.chat",
  },
  {
    title: "about.agents.title",
    body: "about.agents.body",
    image: "guide/agents.png",
    caption: "about.fig.agents",
  },
  {
    title: "about.phrases.title",
    body: "about.phrases.body",
    image: "guide/phrases.png",
    caption: "about.fig.phrases",
  },
  {
    title: "about.sessions.title",
    body: "about.sessions.body",
    image: "guide/sessions.png",
    caption: "about.fig.sessions",
  },
];

async function copyPrompt(): Promise<void> {
  await navigator.clipboard.writeText(t("about.ask.prompt"));
  copied.value = true;
  window.setTimeout(() => {
    copied.value = false;
  }, 1600);
}
</script>

<template>
  <article class="about">
    <h1>{{ t("about.home.title") }}</h1>
    <p class="about__lead">{{ t("about.lead") }}</p>

    <section>
      <h2>{{ t("about.features.title") }}</h2>
      <ul>
        <li v-for="key in features" :key="key">{{ t(key) }}</li>
      </ul>
    </section>

    <section>
      <h2>{{ t("about.quick.title") }}</h2>
      <ol>
        <li v-for="key in quick" :key="key">{{ t(key) }}</li>
      </ol>
    </section>

    <section>
      <h2>{{ t("about.byok.title") }}</h2>
      <p>{{ t("about.byok.body") }}</p>
    </section>

    <section>
      <h2>{{ t("about.ask.title") }}</h2>
      <p>{{ t("about.ask.body") }}</p>
      <pre class="about__prompt">{{ t("about.ask.prompt") }}</pre>
      <button type="button" class="about__copy" @click="copyPrompt">
        {{ copied ? t("about.ask.copied") : t("about.ask.copy") }}
      </button>
    </section>

    <section>
      <h2>{{ t("about.catalog.title") }}</h2>
      <p class="about__lead">{{ t("about.catalog.cors") }}</p>

      <h3>{{ t("about.catalog.agents") }}</h3>
      <ul class="about__cards">
        <li v-for="agent in connectableAgents" :key="agent.id">
          <div class="about__card-head">
            <strong>{{ agent.name }}</strong>
            <a :href="agent.site" target="_blank" rel="noopener noreferrer">{{ t("providers.openSite") }}</a>
          </div>
          <p>{{ t(("about.agent." + agent.id) as "about.agent.picoclaw") }}</p>
          <p class="about__meta">
            <span>{{ t("connections.protocolLabel") }}</span>
            <code>{{ t(("connections.protocol." + agent.protocol) as "connections.protocol.openai") }}</code>
          </p>
          <p class="about__meta">
            <span>{{ t("providers.baseLabel") }}</span>
            <code>{{ agent.address }}</code>
          </p>
          <p v-if="agent.model" class="about__meta">
            <span>{{ t("about.catalog.model") }}</span>
            <code>{{ agent.model }}</code>
          </p>
          <a :href="agent.docs" target="_blank" rel="noopener noreferrer">{{ t("about.catalog.docs") }}</a>
        </li>
      </ul>

      <h3>{{ t("about.catalog.models") }}</h3>
      <p>{{ t("providers.lead") }}</p>
      <ul class="about__cards">
        <li v-for="provider in connectableProviders" :key="provider.id">
          <div class="about__card-head">
            <strong>{{ provider.name }}</strong>
            <a :href="provider.site" target="_blank" rel="noopener noreferrer">{{ t("providers.openSite") }}</a>
          </div>
          <p>{{ t(("providers.hint." + provider.hint) as "providers.hint.cloud") }}</p>
          <p class="about__meta">
            <span>{{ t("providers.baseLabel") }}</span>
            <code>{{ provider.baseUrl }}</code>
          </p>
        </li>
      </ul>
    </section>

    <section v-for="section in sections" :key="section.title">
      <h2>{{ t(section.title) }}</h2>
      <p>{{ t(section.body) }}</p>
      <figure>
        <img :src="base + section.image" alt="" />
        <figcaption>{{ t(section.caption) }}</figcaption>
      </figure>
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
  margin: 1.6rem 0 0.4rem;
  font-size: 1.05rem;
}

.about h3 {
  margin: 1.2rem 0 0.4rem;
  font-size: 0.95rem;
}

.about__cards {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.about__cards li {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--panel);
}

.about__card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.about__cards a {
  color: var(--accent);
  font-size: 0.88rem;
}

.about__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--muted);
  font-size: 0.85rem;
}

.about code {
  color: inherit;
  word-break: break-all;
}

.about p,
.about li {
  line-height: 1.5;
}

.about__lead {
  margin: 0;
  color: var(--muted);
}

.about ul,
.about ol {
  margin: 0;
  padding-inline-start: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.about__prompt {
  margin: 12px 0 0;
  padding: 12px;
  overflow: auto;
  white-space: pre-wrap;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--panel-2);
  font: 0.82rem/1.45 ui-monospace, monospace;
}

.about__copy {
  margin-top: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  color: inherit;
  font: inherit;
  padding: 6px 12px;
  cursor: pointer;
}

.about figure {
  margin: 12px 0 0;
}

.about img {
  display: block;
  width: 100%;
  height: auto;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--panel);
}

.about figcaption {
  margin-top: 6px;
  color: var(--muted);
  font-size: 0.82rem;
}
</style>
