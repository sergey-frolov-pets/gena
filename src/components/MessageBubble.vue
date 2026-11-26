<script setup lang="ts">
/**
 * Одно сообщение ленты: пузырь, markdown-текст, история правок, картинки,
 * документы и кнопки действий.
 *
 * Компонент только рисует. Текст приходит в том виде, который должен увидеть
 * человек (значения или токены решает ChatView), а правка, копирование,
 * озвучка, выгрузка и повтор уходят событиями наружу — там живёт ход.
 */

import { computed } from "vue";
import { useLocale } from "@/i18n";
import { markdownLabels, mdHtml } from "@/lib/chat-markdown";
import { formatBytes } from "@/lib/documents";
import type { Message, MessageAttachment } from "@/storage/types";

const props = withDefaults(
  defineProps<{
    /** Сообщение: роль, вид, вложения, история правок. */
    message: Message;
    /** Текст в том виде, в каком его видит человек. */
    text: string;
    /** Предыдущие версии текста, если реплику правили. */
    editTexts?: string[];
    /** Картинки сообщения. */
    images?: MessageAttachment[];
    /** Документы сообщения. */
    files?: MessageAttachment[];
    /** Подпись автора в ленте. */
    roleName: string;
    /** Время появления сообщения. */
    clock?: string;
    /** Длительность ответа. */
    elapsed?: string;
    /** Текущее вхождение токена — рамка вокруг пузыря. */
    tokenTarget?: boolean;
    /** Текст только что скопирован — галочка вместо иконки. */
    copied?: boolean;
    /** Это сообщение озвучивается прямо сейчас. */
    speaking?: boolean;
    /** Озвучка доступна в этом браузере. */
    speechAvailable?: boolean;
    /** Свою реплику можно забрать в поле ввода. */
    canLift?: boolean;
    /** У ответа можно запросить повтор. */
    canRegenerate?: boolean;
  }>(),
  { editTexts: () => [], images: () => [], files: () => [] },
);

const emit = defineEmits<{
  /** Забрать свою реплику в поле ввода. */
  lift: [];
  /** Скопировать текст сообщения. */
  copy: [];
  /** Включить или остановить озвучку. */
  speak: [];
  /** Выгрузить ответ файлом. */
  download: [kind: "md" | "txt", event: MouseEvent];
  /** Запросить повтор ответа. */
  regenerate: [];
  /** Открыть вложение (лайтбокс или документ). */
  openAttachment: [attachment: MessageAttachment];
  /** Скачать вложение (картинку или документ) из ленты. */
  saveAttachment: [attachment: MessageAttachment, event: MouseEvent];
  /** Отдать вложение в системное меню «Поделиться». */
  shareAttachment: [attachment: MessageAttachment, event: MouseEvent];
  /** Клик по кнопкам внутри markdown (код, таблицы). */
  markdownClick: [event: MouseEvent];
  /** Клик по пузырю: свою реплику забираем в поле ввода. */
  messageClick: [event: MouseEvent];
  /** Картинка догрузилась — лента держит нижнюю границу. */
  imageLoad: [];
}>();

const { t } = useLocale();

const labels = computed(() => markdownLabels(t));
const html = computed(() => mdHtml(props.text, labels.value));
const editHtml = computed(() => props.editTexts.map((value) => mdHtml(value, labels.value)));
/** В пузыре показываем не больше четырёх миниатюр. */
const visibleImages = computed(() => props.images.slice(0, 4));
/** Имя вложения для подписи и `aria-label`; без имени — нейтральное «вложение». */
function attachName(attachment: MessageAttachment): string {
  const name = attachment.name?.trim();
  return name || t("chat.attachUntitled");
}
const canExport = computed(
  () =>
    props.message.role === "assistant" &&
    (!props.message.kind || props.message.kind === "text") &&
    Boolean(props.message.content),
);
</script>

<template>
  <article
    class="chat-panel__message"
    :class="[`chat-panel__message--${message.role}`, { 'is-token-target': tokenTarget }]"
    :data-message-id="message.id"
    @click="emit('messageClick', $event)"
  >
    <span class="chat-panel__role">
      <span class="chat-panel__time">{{ clock }}</span>
      <span class="chat-panel__role-name">{{ roleName }}</span>
      <span v-if="elapsed" class="chat-panel__elapsed">{{ elapsed }}</span>
    </span>
    <div
      v-if="text"
      class="chat-panel__content md"
      @click="emit('markdownClick', $event)"
      v-html="html"
    ></div>
    <details v-if="editTexts.length" class="chat-panel__edits">
      <summary>{{ t("chat.edited") }}</summary>
      <div
        v-for="(value, i) in editHtml"
        :key="i"
        class="chat-panel__content md"
        @click="emit('markdownClick', $event)"
        v-html="value"
      ></div>
    </details>
    <div v-if="images.length" class="chat-panel__images" :data-count="Math.min(images.length, 4)">
      <div v-for="(a, i) in visibleImages" :key="i" class="chat-panel__attach">
        <button
          type="button"
          class="chat-panel__image"
          :aria-label="attachName(a)"
          @click="emit('openAttachment', a)"
        >
          <img :src="a.thumb" alt="" loading="lazy" @load="emit('imageLoad')" />
          <!-- Имя картинки: видно при наведении, чтобы не занимать место всегда. -->
          <span class="chat-panel__image-name">{{ attachName(a) }}</span>
        </button>
        <div class="chat-panel__attach-actions">
          <button
            type="button"
            class="chat-panel__attach-button"
            v-tip="t('chat.attachDownload')"
            :aria-label="t('chat.attachDownload')"
            @click="emit('saveAttachment', a, $event)"
          >
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 4v11" />
              <path d="m7 11 5 5 5-5" />
              <path d="M5 20h14" />
            </svg>
            <span>{{ t("chat.attachDownload") }}</span>
          </button>
          <button
            type="button"
            class="chat-panel__attach-button"
            v-tip="t('chat.attachShare')"
            :aria-label="t('chat.attachShare')"
            @click="emit('shareAttachment', a, $event)"
          >
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 16V5" />
              <path d="m8 8 4-3 4 3" />
              <path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
            </svg>
            <span>{{ t("chat.attachShare") }}</span>
          </button>
        </div>
      </div>
    </div>
    <div v-if="files.length" class="chat-panel__file-row">
      <div v-for="(a, i) in files" :key="`file-${i}`" class="chat-panel__attach">
        <button
          type="button"
          class="chat-panel__file-badge"
          :title="a.name"
          :aria-label="a.name"
          @click="emit('openAttachment', a)"
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path d="M14 3v5h5" />
          </svg>
          <span class="chat-panel__file-name">{{ a.name }}</span>
          <span v-if="a.bytes" class="chat-panel__file-size">{{ formatBytes(a.bytes) }}</span>
        </button>
        <div class="chat-panel__attach-actions">
          <button
            type="button"
            class="chat-panel__attach-button"
            v-tip="t('chat.attachDownload')"
            :aria-label="t('chat.attachDownload')"
            @click="emit('saveAttachment', a, $event)"
          >
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 4v11" />
              <path d="m7 11 5 5 5-5" />
              <path d="M5 20h14" />
            </svg>
            <span>{{ t("chat.attachDownload") }}</span>
          </button>
          <button
            type="button"
            class="chat-panel__attach-button"
            v-tip="t('chat.attachShare')"
            :aria-label="t('chat.attachShare')"
            @click="emit('shareAttachment', a, $event)"
          >
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 16V5" />
              <path d="m8 8 4-3 4 3" />
              <path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
            </svg>
            <span>{{ t("chat.attachShare") }}</span>
          </button>
        </div>
      </div>
    </div>
    <div class="chat-panel__message-actions">
      <button
        v-if="canLift"
        type="button"
        class="chat-panel__action"
        v-tip="t('chat.liftMessage')"
        :aria-label="t('chat.liftMessage')"
        @click="emit('lift')"
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 20h4l10-10a2.8 2.8 0 1 0-4-4L4 16z" />
        </svg>
      </button>
      <button
        type="button"
        class="chat-panel__action"
        v-tip="copied ? t('chat.copied') : t('chat.copyMessage')"
        :aria-label="t('chat.copyMessage')"
        @click="emit('copy')"
      >
        <svg v-if="copied" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m5 13 4 4L19 7" />
        </svg>
        <svg v-else viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
      </button>
      <button
        v-if="speechAvailable && text"
        type="button"
        class="chat-panel__action"
        :class="{ 'is-on': speaking }"
        v-tip="speaking ? t('chat.stopSpeaking') : t('chat.speakReply')"
        :aria-label="speaking ? t('chat.stopSpeaking') : t('chat.speakReply')"
        :aria-pressed="speaking"
        @click="emit('speak')"
      >
        <svg v-if="speaking" viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
          <rect x="7" y="7" width="10" height="10" rx="2" />
        </svg>
        <svg v-else viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M11 5 6 9H3v6h3l5 4z" />
          <path d="M16 9a4 4 0 0 1 0 6" />
        </svg>
      </button>
      <button
        v-if="canExport"
        type="button"
        class="chat-panel__action chat-panel__export"
        v-tip="t('chat.downloadMd')"
        :aria-label="t('chat.downloadMd')"
        @click="emit('download', 'md', $event)"
      >
        MD
      </button>
      <button
        v-if="canExport"
        type="button"
        class="chat-panel__action chat-panel__export"
        v-tip="t('chat.downloadTxt')"
        :aria-label="t('chat.downloadTxt')"
        @click="emit('download', 'txt', $event)"
      >
        TXT
      </button>
      <button
        v-if="canRegenerate"
        type="button"
        class="chat-panel__action"
        v-tip="t('chat.regenerate')"
        :aria-label="t('chat.regenerate')"
        @click="emit('regenerate')"
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M20 12a8 8 0 1 1-2.34-5.66" />
          <path d="M20 4v5h-5" />
        </svg>
      </button>
    </div>
  </article>
</template>

<style scoped>
.chat-panel__message {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: min(100%, 36rem);
  padding: 4px 10px;
  border-radius: 14px;
}

.chat-panel__message--user {
  align-self: flex-end;
  margin-inline-start: 2rem;
  background: color-mix(in srgb, var(--accent) 14%, var(--panel));
  border-end-end-radius: 4px;
}

.chat-panel__message--assistant {
  align-self: flex-start;
  margin-inline-start: 0.75rem;
  margin-inline-end: 1.25rem;
  padding-inline: 0;
  background: transparent;
}

.chat-panel__role {
  color: var(--muted);
  font-size: 0.68rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  display: inline-flex;
  align-items: baseline;
  gap: 0.35rem;
}

.chat-panel__time {
  font-size: 0.64rem;
  font-variant-numeric: tabular-nums;
  opacity: 0.75;
}

.chat-panel__elapsed {
  font-size: 0.62rem;
  letter-spacing: 0;
  text-transform: none;
  font-variant-numeric: tabular-nums;
  opacity: 0.85;
  white-space: nowrap;
}

.chat-panel__content {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.45;
  font-size: 0.88rem;
}

.chat-panel__message-actions {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity 120ms ease;
}

.chat-panel__message:hover .chat-panel__message-actions,
.chat-panel__message:focus-within .chat-panel__message-actions,
.chat-panel__message:last-child .chat-panel__message-actions {
  opacity: 1;
}

.chat-panel__edits {
  margin-top: 2px;
  color: var(--muted);
  font-size: 0.72rem;
}

.chat-panel__edits summary {
  cursor: pointer;
}

.chat-panel__edits .chat-panel__content {
  margin-top: 4px;
  padding-inline-start: 8px;
  border-inline-start: 2px solid var(--border);
  opacity: 0.75;
  font-size: 0.8rem;
}

.chat-panel__images {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  max-width: 20rem;
}

.chat-panel__images[data-count="1"] {
  grid-template-columns: minmax(0, 1fr);
}

.chat-panel__image {
  position: relative;
  display: block;
  width: 100%;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--panel-2);
  aspect-ratio: 4 / 3;
}

.chat-panel__image img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.chat-panel__file-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.chat-panel__file-badge {
  display: inline-flex;
  align-items: flex-start;
  gap: 5px;
  max-width: 100%;
  padding: 5px 9px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--panel-2);
  color: var(--muted);
  font: inherit;
  font-size: 0.75rem;
  text-align: start;
  cursor: pointer;
}

/* Значок держим у первой строки имени, а не по центру многострочного блока. */
.chat-panel__file-badge svg {
  flex: 0 0 auto;
  margin-top: 2px;
}

.chat-panel__file-badge:hover,
.chat-panel__file-badge:focus-visible {
  border-color: var(--accent);
  color: var(--text);
}

/* Имя файла показываем целиком: длинное — переносится, а не режется многоточием. */
.chat-panel__file-name {
  min-width: 0;
  color: var(--text);
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.chat-panel__file-size {
  flex: 0 0 auto;
  margin-top: 1px;
  white-space: nowrap;
  opacity: 0.8;
}

/* Вложение = сам файл + строка действий под ним, как копирование у ответа. */
.chat-panel__attach {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.chat-panel__attach-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  opacity: 0;
  transition: opacity 120ms ease;
}

.chat-panel__message:hover .chat-panel__attach-actions,
.chat-panel__message:focus-within .chat-panel__attach-actions {
  opacity: 1;
}

.chat-panel__attach-button {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 5px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 0.66rem;
  line-height: 1.4;
  cursor: pointer;
}

.chat-panel__attach-button:hover,
.chat-panel__attach-button:focus-visible {
  background: var(--panel-2);
  color: var(--text);
}

/* Имя картинки видно по наведению, иначе оно съедало бы место в сетке. */
.chat-panel__image-name {
  position: absolute;
  inset-inline: 0;
  bottom: 0;
  padding: 2px 6px;
  overflow: hidden;
  background: color-mix(in srgb, var(--panel) 82%, transparent);
  color: var(--text);
  font-size: 0.62rem;
  line-height: 1.3;
  text-align: start;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0;
  transition: opacity 120ms ease;
  pointer-events: none;
}

.chat-panel__image:hover .chat-panel__image-name,
.chat-panel__image:focus-visible .chat-panel__image-name {
  opacity: 1;
}

/* На телефоне наведения нет: действия и имя показываем сразу. */
@media (max-width: 720px) {
  .chat-panel__attach-actions {
    opacity: 1;
  }
  .chat-panel__attach-button {
    font-size: 0.7rem;
  }
  .chat-panel__image-name {
    opacity: 1;
  }
}

.chat-panel__message.is-token-target {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
/* Широкий монитор: обе стороны ленты стоят слева. Своя реплика остаётся
   подкрашенной (её видно по фону и подписи), но выравнивание — как у ответов:
   глазам не приходится перескакивать с края на край по широкой панели.
   На телефоне и планшете реплики остаются по разным сторонам. */
@media (min-width: 1100px) {
  .chat-panel__message {
    max-width: 100%;
  }
  .chat-panel__content {
    font-size: 0.95rem;
  }
  .chat-panel__message--user {
    align-self: flex-start;
    margin-inline-start: 0.75rem;
    margin-inline-end: 1.25rem;
    border-end-end-radius: 14px;
    border-end-start-radius: 4px;
  }
}

@media (max-width: 720px) {
  .chat-panel__message {
    max-width: min(100%, 34rem);
    padding: 6px 10px;
  }
  .chat-panel__content {
    font-size: 0.95rem;
    line-height: 1.5;
  }
  .chat-panel__role {
    font-size: 0.72rem;
  }
  .chat-panel__message-actions {
    opacity: 1;
  }
  .chat-panel__message--user {
    margin-inline-start: 1rem;
  }
}
</style>
