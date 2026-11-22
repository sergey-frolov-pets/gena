<script setup lang="ts">
/**
 * Чипы подготовленных вложений в композере: миниатюры картинок и документы.
 *
 * Компонент только рисует. Подготовка (сжатие картинок, чтение документов,
 * лимиты и тексты ошибок) остаётся в вызывающем — он передаёт уже готовые
 * записи и получает событие удаления по индексу.
 */

import { useLocale } from "@/i18n";
import { formatBytes } from "@/lib/documents";

defineProps<{
  /** Подготовленные картинки: нужна только миниатюра. */
  images: { thumb: string }[];
  /** Подготовленные документы: имя и размер. */
  docs: { name: string; bytes: number }[];
}>();

const emit = defineEmits<{
  removeImage: [index: number];
  removeDocument: [index: number];
}>();

const { t } = useLocale();
</script>

<template>
  <div v-if="images.length > 0 || docs.length > 0" class="attachment-tray">
    <div v-for="(img, i) in images" :key="`img-${i}`" class="attachment-tray__chip">
      <img :src="img.thumb" alt="" />
      <button
        type="button"
        class="attachment-tray__remove"
        v-tip="t('chat.attachRemove')"
        :aria-label="t('chat.attachRemove')"
        @click="emit('removeImage', i)"
      >
        ×
      </button>
    </div>
    <div
      v-for="(doc, i) in docs"
      :key="`doc-${i}`"
      class="attachment-tray__chip is-file"
      :title="`${doc.name} · ${formatBytes(doc.bytes)}`"
    >
      <span class="attachment-tray__name">{{ doc.name }}</span>
      <span class="attachment-tray__size">{{ formatBytes(doc.bytes) }}</span>
      <button
        type="button"
        class="attachment-tray__remove"
        v-tip="t('chat.attachRemove')"
        :aria-label="t('chat.attachRemove')"
        @click="emit('removeDocument', i)"
      >
        ×
      </button>
    </div>
  </div>
</template>

<style scoped>
.attachment-tray {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.attachment-tray__chip {
  position: relative;
  width: 56px;
  height: 56px;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--panel-2);
}

.attachment-tray__chip img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* Документ в чипе: имя + размер вместо миниатюры. */
.attachment-tray__chip.is-file {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  width: auto;
  min-width: 120px;
  max-width: 200px;
  height: 56px;
  padding: 6px 26px 6px 10px;
}

.attachment-tray__name {
  display: block;
  overflow: hidden;
  color: var(--text);
  font-size: 0.78rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attachment-tray__size {
  color: var(--muted);
  font-size: 0.72rem;
}

.attachment-tray__remove {
  position: absolute;
  top: 2px;
  inset-inline-end: 2px;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(13, 17, 23, 0.72);
  color: #fff;
  font-size: 13px;
  line-height: 1;
}
</style>
