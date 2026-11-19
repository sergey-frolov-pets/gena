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
  <label class="lang">
    <span class="muted small">{{ t("app.language") }}</span>
    <select :value="locale" @change="onChange">
      <option v-for="opt in options" :key="opt.code" :value="opt.code">{{ opt.label }}</option>
    </select>
  </label>
</template>

<style scoped>
.lang {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
}
.lang select {
  width: auto;
}
.small {
  font-size: 12px;
}
</style>
