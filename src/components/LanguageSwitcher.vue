<script setup lang="ts">
import { computed } from "vue";
import { useLocale } from "@/i18n";
import { LOCALE_LABELS, SUPPORTED_LOCALES, type AppLocale } from "@/i18n/constants";

const { locale, setLocale, t } = useLocale();

const options = computed(() =>
  SUPPORTED_LOCALES.map((code) => ({ code, label: LOCALE_LABELS[code] })),
);

function onChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value as AppLocale;
  setLocale(value);
}
</script>

<template>
  <label class="lang" v-tip="t('app.language')">
    <svg
      class="lang-icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z" />
    </svg>
    <select :value="locale" :aria-label="t('app.language')" @change="onChange">
      <option v-for="opt in options" :key="opt.code" :value="opt.code">{{ opt.label }}</option>
    </select>
  </label>
</template>

<style scoped>
.lang {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  flex: none;
}
.lang-icon {
  flex: none;
}
.lang select {
  width: auto;
  max-width: 7.5rem;
  padding: 5px 6px;
  line-height: 1.2;
  font-size: 0.86rem;
}

/* Телефон: без глобуса и уже — чтобы хедер держался в одну строку. */
@media (max-width: 480px) {
  .lang {
    gap: 0;
  }
  .lang-icon {
    display: none;
  }
  .lang select {
    max-width: 5rem;
    padding: 4px 4px;
    font-size: 0.74rem;
  }
}
</style>
