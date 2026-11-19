<script setup lang="ts">
import { useTheme } from "@/lib/theme";
import { useLocale } from "@/i18n";

const { theme, toggle } = useTheme();
const { t } = useLocale();
</script>

<template>
  <button
    class="theme-btn"
    type="button"
    :aria-label="t('app.theme.toggle')"
    :title="t('app.theme.toggle')"
    @click="toggle"
  >
    <span aria-hidden="true">{{ theme === "dark" ? "☀️" : "🌙" }}</span>
    <span>{{ theme === "dark" ? t("app.theme.light") : t("app.theme.dark") }}</span>
  </button>
</template>

<style scoped>
.theme-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
</style>
