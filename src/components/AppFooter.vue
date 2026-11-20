<script setup lang="ts">
import { useLocale } from "../i18n";

const { t } = useLocale();

const year = new Date().getFullYear();
const logo = `${import.meta.env.BASE_URL}fsvibe-logo.svg`;
const GITHUB = "https://github.com/sergey-frolov-pets/gena";
const LICENSE = "https://github.com/sergey-frolov-pets/gena/blob/main/LICENSE";
const DONATE = "https://github.com/sponsors/sergey-frolov-pets";
const VERSION = "0.1.25";
</script>

<template>
  <footer class="app-footer">
    <div class="app-footer__brand">
      <span class="app-footer__year">© {{ year }}</span>
      <img class="app-footer__logo" :src="logo" alt="FSVibe" decoding="async" />
    </div>
    <nav class="app-footer__links" :aria-label="t('app.footer.links')">
      <a :href="GITHUB" target="_blank" rel="noopener noreferrer">GitHub</a>
      <a :href="LICENSE" target="_blank" rel="noopener noreferrer">{{ t("app.footer.license") }}</a>
    </nav>
    <div class="app-footer__meta">
      <span class="app-footer__version" :title="t('app.footer.versionHint')">v{{ VERSION }}</span>
      <a
        class="app-footer__donate"
        :href="DONATE"
        target="_blank"
        rel="noopener noreferrer"
        :aria-label="t('app.footer.support')"
        :title="t('app.footer.support')"
      >
        <svg viewBox="0 0 576 512" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path
            d="M163.9 136.9c-29.4-29.8-29.4-78.2 0-108s77-29.8 106.4 0l17.7 18 17.7-18c29.4-29.8 77-29.8 106.4 0s29.4 78.2 0 108L310.5 240.1c-6.2 6.3-14.3 9.4-22.5 9.4s-16.3-3.1-22.5-9.4L163.9 136.9zM568.2 336.3c13.1 17.8 9.3 42.8-8.5 55.9L433.1 485.5c-23.4 17.2-51.6 26.5-80.7 26.5H192 32c-17.7 0-32-14.3-32-32V416c0-17.7 14.3-32 32-32H68.8l44.9-36c22.7-18.2 50.9-28 80-28H272h16 64c17.7 0 32 14.3 32 32s-14.3 32-32 32H288 272c-8.8 0-16 7.2-16 16s7.2 16 16 16H392.6l119.7-88.2c17.8-13.1 42.8-9.3 55.9 8.5zM193.6 384l0 0-.9 0c.3 0 .6 0 .9 0z"
          />
        </svg>
      </a>
    </div>
  </footer>
</template>

<style scoped>
.app-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 12px 20px;
  border-top: 1px solid var(--border);
  background: var(--panel);
}

.app-footer__brand {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--muted);
  font-size: 13px;
}

.app-footer__logo {
  height: 0.9rem;
  width: auto;
  display: block;
}

.app-footer__links {
  display: flex;
  gap: 14px;
}

.app-footer__links a {
  color: var(--muted);
  text-decoration: none;
  font-size: 13px;
}

.app-footer__links a:hover {
  color: var(--text);
  text-decoration: underline;
}

.app-footer__meta {
  display: flex;
  align-items: center;
  gap: 12px;
}

.app-footer__version {
  color: var(--muted);
  font-size: 12px;
}

.app-footer__donate {
  display: inline-flex;
  color: var(--danger);
  line-height: 0;
}

.app-footer__donate svg {
  width: 16px;
  height: 16px;
  fill: currentColor;
}

.app-footer__donate:hover {
  color: var(--accent);
}
</style>
