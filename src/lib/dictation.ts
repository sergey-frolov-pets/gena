/**
 * Диктовка (STT) — порт идеи `useDictation` из code2graph на транспорт Gena.
 *
 * Используется Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`):
 * распознаёт сам браузер, ключей не нужно. Поддержка — Chrome/Edge/Android;
 * в Firefox и Safari API нет, тогда кнопка микрофона не показывается
 * (см. `dictationAvailable`).
 */

import { ref, type Ref } from "vue";
import type { AppLocale } from "@/i18n/constants";

/** Тег языка для SpeechRecognition/speechSynthesis. */
const SPEECH_TAGS: Record<AppLocale, string> = {
  en: "en-US",
  ru: "ru-RU",
  es: "es-ES",
  zh: "zh-CN",
  ja: "ja-JP",
  hi: "hi-IN",
  pt: "pt-BR",
  de: "de-DE",
  ar: "ar-SA",
};

/** Язык интерфейса берём из <html lang> — его синхронизирует i18n. */
export function currentLanguageCode(): string {
  if (typeof document === "undefined") return "en";
  return (document.documentElement.lang || "en").slice(0, 2).toLowerCase();
}

export function speechTag(lang: string): string {
  return SPEECH_TAGS[lang as AppLocale] ?? "en-US";
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
  length: number;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionErrorLike {
  error: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
}

type RecognitionCtor = new () => SpeechRecognitionLike;

/** Признак «диктовка доступна» — вычисляется один раз при импорте. */
export const dictationAvailable = ref(false);

export const dictationListening = ref(false);

/** Код ошибки Web Speech API у последнего запуска. */
export const dictationError = ref("");

interface DictationSession {
  recognition: SpeechRecognitionLike;
  prefix: string;
  finals: string;
  draft: Ref<string>;
  suppressRestart: boolean;
}

let activeSession: DictationSession | null = null;

function readCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const host = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return host.SpeechRecognition ?? host.webkitSpeechRecognition ?? null;
}

const ctor = readCtor();
dictationAvailable.value = Boolean(ctor);

/** Фатальные ошибки — останавливаемся и показываем сообщение. */
const FATAL = new Set(["not-allowed", "service-not-allowed", "audio-capture", "network"]);

function publish(session: DictationSession, interim: string): void {
  const parts = [session.prefix, session.finals, interim].filter((part) => part.trim().length > 0);
  session.draft.value = parts.join(" ").replace(/\s+/g, " ").trimStart();
}

export function stopDictation(): void {
  const session = activeSession;
  activeSession = null;
  dictationListening.value = false;
  if (!session) return;
  session.suppressRestart = true;
  try {
    session.recognition.stop();
  } catch {
    // Уже остановлен — ничего страшного.
  }
}

function startDictation(draft: Ref<string>): void {
  if (!ctor) return;
  stopDictation();

  const recognition = new ctor();
  recognition.lang = speechTag(currentLanguageCode());
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onresult = null;
  recognition.onerror = null;
  recognition.onend = null;

  const session: DictationSession = {
    recognition,
    prefix: draft.value ? `${draft.value.trimEnd()} ` : "",
    finals: "",
    draft,
    suppressRestart: false,
  };

  recognition.onresult = (event) => {
    if (activeSession !== session || session.suppressRestart) return;
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = result[0]?.transcript ?? "";
      if (result.isFinal) {
        session.finals = `${session.finals} ${text}`.trim();
      } else {
        interim += text;
      }
    }
    publish(session, interim);
  };

  recognition.onerror = (event) => {
    if (activeSession !== session) return;
    if (!FATAL.has(event.error)) return;
    session.suppressRestart = true;
    activeSession = null;
    dictationListening.value = false;
    dictationError.value = event.error;
  };

  recognition.onend = () => {
    if (activeSession !== session) return;
    if (session.suppressRestart) {
      activeSession = null;
      dictationListening.value = false;
      return;
    }
    // Браузер сам обрывает поток через ~60 с — перезапускаем, пока не остановил пользователь.
    try {
      recognition.start();
    } catch {
      activeSession = null;
      dictationListening.value = false;
      dictationError.value = "network";
    }
  };

  activeSession = session;
  dictationListening.value = true;
  dictationError.value = "";
  try {
    recognition.start();
  } catch {
    activeSession = null;
    dictationListening.value = false;
    dictationError.value = "not-allowed";
  }
}

export function toggleDictation(draft: Ref<string>): void {
  if (dictationListening.value) {
    stopDictation();
    return;
  }
  startDictation(draft);
}
