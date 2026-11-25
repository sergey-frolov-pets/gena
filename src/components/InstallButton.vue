<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useLocale } from "../i18n";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Компактная иконка в шапке меню или полноценный пункт меню.
 * Пункт меню нужен, чтобы установку было видно словами, а не только по иконке.
 */
const props = withDefaults(defineProps<{ asMenu?: boolean }>(), { asMenu: false });

const { t } = useLocale();
const canInstall = ref(false);
const installed = ref(false);
let deferredPrompt: BeforeInstallPromptEvent | null = null;

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

function onBeforeInstallPrompt(event: Event) {
  event.preventDefault();
  deferredPrompt = event as BeforeInstallPromptEvent;
  canInstall.value = true;
}

function onAppInstalled() {
  installed.value = true;
  canInstall.value = false;
  deferredPrompt = null;
}

async function install() {
  if (!deferredPrompt) return;
  await deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice;
  if (choice.outcome === "accepted") {
    onAppInstalled();
  }
  deferredPrompt = null;
  canInstall.value = false;
}

onMounted(() => {
  installed.value = isStandalone();
  window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  window.addEventListener("appinstalled", onAppInstalled);
});

onBeforeUnmount(() => {
  window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  window.removeEventListener("appinstalled", onAppInstalled);
});
</script>

<template>
  <button
    v-if="canInstall && !installed"
    :class="props.asMenu ? 'menu-install' : 'install-btn'"
    :role="props.asMenu ? 'menuitem' : undefined"
    type="button"
    :aria-label="t('app.install')"
    :v-tip="props.asMenu ? null : t('app.install')"
    @click="install"
  >
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
      <path d="M12 3v11" />
      <path d="m7 10 5 5 5-5" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
    <span v-if="props.asMenu">{{ t("app.install") }}</span>
  </button>
</template>

<style scoped>
.install-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 8px;
  line-height: 0;
}

/* Пункт меню: иконка + подпись, поведение как у остальных пунктов. */
.menu-install {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
}

.menu-install svg {
  flex: none;
}

.menu-install:hover {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
</style>
