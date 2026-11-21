/**
 * Озвучка ответов (TTS) — порт идеи `useReplySpeech` из code2graph.
 *
 * Web Speech Synthesis: голоса даёт система, ключей и сети не нужно.
 * Если голосов нет (или браузер без API) — кнопка озвучки не показывается.
 */

import { ref } from "vue";
import { currentLanguageCode, speechTag } from "./dictation";

const AVAILABLE_KEY = "gena-speech-available";
const AUTO_KEY = "gena-speech-auto";

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // Приватный режим — настройка просто не запомнится.
  }
}

function synthesizer(): SpeechSynthesis | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  if (typeof SpeechSynthesisUtterance === "undefined") return null;
  return window.speechSynthesis;
}

export const speechAvailable = ref(false);
export const speakingId = ref<string | null>(null);
export const autoSpeak = ref(readFlag(AUTO_KEY));

/** Убираем markdown-разметку: вслух нужен текст, а не `**` и ```. */
export function stripForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_~>#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function refreshAvailable(): void {
  const synth = synthesizer();
  speechAvailable.value = Boolean(synth && synth.getVoices().length > 0);
  writeFlag(AVAILABLE_KEY, speechAvailable.value);
}

if (typeof window !== "undefined") {
  const synth = synthesizer();
  if (synth) {
    synth.addEventListener?.("voiceschanged", refreshAvailable);
    refreshAvailable();
  }
}

export function stopSpeaking(): void {
  synthesizer()?.cancel();
  speakingId.value = null;
}

export function speak(id: string, text: string): void {
  const synth = synthesizer();
  if (!synth) return;
  const spoken = stripForSpeech(text);
  if (!spoken) return;

  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(spoken);
  utterance.lang = speechTag(currentLanguageCode());
  utterance.rate = speechRate.value;
  const voices = synth.getVoices();
  const matching = voices.find((voice) => voice.lang === utterance.lang);
  if (matching) utterance.voice = matching;

  const done = (): void => {
    if (speakingId.value === id) speakingId.value = null;
  };
  utterance.onend = done;
  utterance.onerror = done;
  speakingId.value = id;
  synth.speak(utterance);
}

export function toggleSpeech(id: string, text: string): void {
  if (speakingId.value === id) {
    stopSpeaking();
    return;
  }
  speak(id, text);
}

export function setAutoSpeak(value: boolean): void {
  autoSpeak.value = value;
  writeFlag(AUTO_KEY, value);
  if (!value) stopSpeaking();
}

// --- Скорость озвучки ------------------------------------------------------

const RATE_KEY = "gena-speech-rate";
/** Варианты скорости в интерфейсе; 1 — обычная. */
export const SPEECH_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5] as const;
const MIN_RATE = 0.5;
const MAX_RATE = 2.5;

function readRate(): number {
  try {
    const raw = Number(localStorage.getItem(RATE_KEY));
    if (!Number.isFinite(raw) || raw <= 0) return 1;
    return Math.min(MAX_RATE, Math.max(MIN_RATE, raw));
  } catch {
    return 1;
  }
}

/** Скорость чтения ответов: 0.5×…2.5×, по умолчанию 1×. */
export const speechRate = ref(readRate());

export function setSpeechRate(value: number): void {
  const next = Math.min(MAX_RATE, Math.max(MIN_RATE, value));
  speechRate.value = next;
  try {
    localStorage.setItem(RATE_KEY, String(next));
  } catch {
    // Приватный режим — настройка просто не запомнится.
  }
}
