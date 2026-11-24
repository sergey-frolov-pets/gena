<script setup lang="ts">
import {
  CHAT_WIDTH_MAX,
  CHAT_WIDTH_MIN,
  FONT_OPTIONS,
  FONT_SIZES,
  useAppearance,
  type AppFont,
} from "@/lib/appearance";
import { useLocale } from "@/i18n";

const { font, fontSize, chatWidth, setFont, setFontSize, setChatWidth } = useAppearance();
const { t } = useLocale();

function onFont(event: Event): void {
  setFont((event.target as HTMLSelectElement).value as AppFont);
}

function onSize(event: Event): void {
  setFontSize(Number((event.target as HTMLSelectElement).value));
}

function onWidth(event: Event): void {
  setChatWidth(Number((event.target as HTMLInputElement).value));
}

function fontLabel(id: AppFont): string {
  if (id === "serif") return t("app.font.serif");
  if (id === "mono") return t("app.font.mono");
  return t("app.font.system");
}
</script>

<template>
  <label class="menu-line">
    <span>{{ t("app.font") }}</span>
    <select :value="font" :aria-label="t('app.font')" @change="onFont">
      <option v-for="id in FONT_OPTIONS" :key="id" :value="id">
        {{ fontLabel(id) }}
      </option>
    </select>
  </label>
  <label class="menu-line">
    <span>{{ t("app.fontSize") }}</span>
    <select :value="fontSize" :aria-label="t('app.fontSize')" @change="onSize">
      <option v-for="size in FONT_SIZES" :key="size" :value="size">{{ size }}</option>
    </select>
  </label>
  <label class="menu-line menu-line--width">
    <span>{{ t("app.chatWidth") }}</span>
    <input
      type="range"
      :min="CHAT_WIDTH_MIN"
      :max="CHAT_WIDTH_MAX"
      step="20"
      :value="chatWidth"
      :aria-label="t('app.chatWidth')"
      :aria-valuetext="`${chatWidth}`"
      @input="onWidth"
    />
    <span class="menu-line__value">{{ chatWidth }}</span>
  </label>
</template>
