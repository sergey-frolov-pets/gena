<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useLocale } from "../i18n";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Кнопка установки PWA: иконка без подписи, подсказка — по наведению (v-tip).
 *
 * `inline` — вариант для строки меню: компактная квадратная иконка, которую
 * ставим у правого края пункта, а не отдельным пунктом. Инструкция браузера
 * (`installHint`) при этом раскрывается под строкой на всю её ширину.
 *
 * Кнопка видна всегда, пока приложение не установлено: браузер отдаёт
 * `beforeinstallprompt` не во всех случаях (уже установлено, не выполнены
 * условия PWA, Safari/Firefox на iOS и т. п.). Если события нет, кнопка
 * открывает инструкцию — раньше пункт в этом случае просто исчезал.
 */
const props = withDefaults(defineProps<{ inline?: boolean }>(), { inline: false });

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
      type="button"
      class="install-btn"
      :class="{ 'install-btn--inline': props.inline }"
      :aria-label="t('app.install')"
      v-tip="t('app.install')"
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
    </button>
    <!-- Системного диалога нет: показываем, где кнопка установки у браузера. -->
    <p v-if="hintOpen" class="install-hint" role="status">
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
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  line-height: 0;
  cursor: pointer;
}

/* Иконка в строке меню: квадрат под размер кнопок-иконок, без растягивания. */
.install-btn--inline {
  flex: none;
  width: 34px;
  height: 34px;
  padding: 0;
}

.install-btn:hover {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

/* Инструкция занимает отдельную строку под пунктом, а не сжимает подпись. */
.install-hint {
  flex: 1 0 100%;
  margin: 0;
  padding: 2px 12px 6px;
  font-size: 0.85rem;
  line-height: 1.35;
  color: var(--muted, color-mix(in srgb, currentColor 65%, transparent));
}
</style>
