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
  <label class="menu-line">
    <svg
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
    <span>{{ t("app.language") }}</span>
    <select :value="locale" :aria-label="t('app.language')" @change="onChange">
      <option v-for="opt in options" :key="opt.code" :value="opt.code">{{ opt.label }}</option>
    </select>
  </label>
</template>
