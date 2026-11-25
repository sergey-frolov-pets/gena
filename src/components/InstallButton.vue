<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useLocale } from "../i18n";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Компактная иконка в шапке или полноценный пункт меню.
 *
 * Пункт меню показывается всегда, пока приложение не установлено: браузер
 * отдаёт `beforeinstallprompt` не во всех случаях (уже установлено, не выполнены
 * условия PWA, Safari/Firefox на iOS и т. п.), и раньше пункт просто исчезал —
 * «установки в меню нет». Если события нет, пункт открывает инструкцию.
 */
const props = withDefaults(defineProps<{ asMenu?: boolean }>(), { asMenu: false });

const { t } = useLocale();
const canInstall = ref(false);
const installed = ref(false);
const hintOpen = ref(false);
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
  hintOpen.value = false;
  deferredPrompt = null;
}

async function install() {
  if (!deferredPrompt) {
    // Браузер не дал системного диалога — объясняем, где кнопка у него.
    hintOpen.value = true;
    return;
  }
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
  <template v-if="!installed">
    <button
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
    <!-- Системного диалога нет: показываем, где кнопка установки у браузера. -->
    <p v-if="hintOpen" class="menu-install__hint" role="status">
      {{ t("app.installHint") }}
    </p>
  </template>
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

.menu-install__hint {
  margin: 0;
  padding: 0 12px 8px;
  font-size: 0.85rem;
  line-height: 1.35;
  color: var(--muted, color-mix(in srgb, currentColor 65%, transparent));
}
</style>
