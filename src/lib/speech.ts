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

/** Счётчик, чтобы список голосов в меню обновился после `voiceschanged`. */
export const speechVoiceTick = ref(0);

function refreshAvailable(): void {
  const synth = synthesizer();
  speechAvailable.value = Boolean(synth && synth.getVoices().length > 0);
  writeFlag(AVAILABLE_KEY, speechAvailable.value);
  speechVoiceTick.value += 1;
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
  const lang = currentLanguageCode();
  utterance.lang = speechTag(lang);
  utterance.rate = speechRate.value;
  utterance.pitch = speechPitch.value;
  utterance.volume = speechVolume.value;
  const pool = speechVoices().filter((voice) => voiceMatchesLanguage(voice, lang));
  const chosen = pool.find((voice) => voiceKey(voice) === speechVoiceId.value);
  const matching = chosen ?? pool.find((voice) => voice.lang.replace("_", "-") === utterance.lang) ?? pool[0];
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
export const SPEECH_RATES = [0.75, 1, 1.25, 1.5, 2] as const;
const MIN_RATE = 0.5;
const MAX_RATE = 2;

function readRate(): number {
  try {
    const raw = Number(localStorage.getItem(RATE_KEY));
    if (!Number.isFinite(raw) || raw <= 0) return 1;
    return Math.min(MAX_RATE, Math.max(MIN_RATE, raw));
  } catch {
    return 1;
  }
}

/** Скорость чтения ответов: 0.75×…2×, по умолчанию 1×. */
export const speechRate = ref(readRate());

const VOICE_KEY = "gena-speech-voice";

function readVoiceId(): string {
  try {
    return localStorage.getItem(VOICE_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Пустая строка — прежний выбор: первый голос языка интерфейса. */
export const speechVoiceId = ref(readVoiceId());

export function setSpeechVoice(voiceURI: string): void {
  speechVoiceId.value = voiceURI;
  try {
    if (voiceURI) localStorage.setItem(VOICE_KEY, voiceURI);
    else localStorage.removeItem(VOICE_KEY);
  } catch {
    // Приватный режим — настройка просто не запомнится.
  }
}

export function speechVoices(): SpeechSynthesisVoice[] {
  return synthesizer()?.getVoices() ?? [];
}

/** Стабильный ключ: на Android `voiceURI` часто пустой. */
export function voiceKey(voice: SpeechSynthesisVoice): string {
  return voice.voiceURI || `${voice.name}|${voice.lang}`;
}

export function voiceMatchesLanguage(voice: SpeechSynthesisVoice, lang: string): boolean {
  const code = voice.lang.toLowerCase().replace("_", "-");
  const wanted = lang.toLowerCase();
  return code === wanted || code.startsWith(`${wanted}-`);
}

/** Движок, насколько его можно прочитать из голоса. Отдельного API провайдера нет. */
export function voiceProvider(voice: SpeechSynthesisVoice): string {
  const blob = `${voice.voiceURI} ${voice.name}`.toLowerCase();
  if (blob.includes("google")) return "Google";
  if (blob.includes("samsung")) return "Samsung";
  if (blob.includes("pico")) return "Pico";
  if (blob.includes("espeak")) return "eSpeak";
  if (blob.includes("microsoft") || blob.includes("edge")) return "Microsoft";
  if (blob.includes("apple") || blob.includes("siri")) return "Apple";
  return voice.localService ? "Local" : "Network";
}

export function loadSpeechVoices(): void {
  refreshAvailable();
}

const PITCH_KEY = "gena-speech-pitch";
const VOLUME_KEY = "gena-speech-volume";

function readUnit(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = Number(localStorage.getItem(key));
    if (!Number.isFinite(raw)) return fallback;
    return Math.min(max, Math.max(min, raw));
  } catch {
    return fallback;
  }
}

function writeUnit(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Приватный режим — настройка просто не запомнится.
  }
}

/** Тембр: 1 — как раньше, ниже — глуше, выше — тоньше. */
export const speechPitch = ref(readUnit(PITCH_KEY, 1, 0.5, 2));
/** Громкость 0…1. По умолчанию полная, как у браузера. */
export const speechVolume = ref(readUnit(VOLUME_KEY, 1, 0, 1));

export function setSpeechPitch(value: number): void {
  speechPitch.value = Math.min(2, Math.max(0.5, value));
  writeUnit(PITCH_KEY, speechPitch.value);
}

export function setSpeechVolume(value: number): void {
  speechVolume.value = Math.min(1, Math.max(0, value));
  writeUnit(VOLUME_KEY, speechVolume.value);
}

export function setSpeechRate(value: number): void {
  const next = Math.min(MAX_RATE, Math.max(MIN_RATE, value));
  speechRate.value = next;
  try {
    localStorage.setItem(RATE_KEY, String(next));
  } catch {
    // Приватный режим — настройка просто не запомнится.
  }
}
