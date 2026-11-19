<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useLocale } from "../i18n";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

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
    class="install-btn"
    type="button"
    :title="t('app.install')"
    @click="install"
  >
    {{ t("app.install") }}
  </button>
</template>

<style scoped>
.install-btn {
  white-space: nowrap;
}
</style>
