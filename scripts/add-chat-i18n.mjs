// Добавляет ключи чата для голоса (STT/TTS) во все словари.
// Идемпотентно: уже добавленные ключи не дублируются.
// Запуск: node scripts/add-chat-i18n.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const KEYS = [
  "chat.copyMessage",
  "chat.copied",
  "chat.speakReply",
  "chat.stopSpeaking",
  "chat.autoSpeak",
  "chat.dictate",
  "chat.dictateStop",
  "chat.dictateRecording",
  "chat.dictateError.notAllowed",
  "chat.dictateError.network",
  "chat.regenerate",
];

const TEXT = {
  en: [
    "Copy",
    "Copied",
    "Read aloud",
    "Stop reading",
    "Read replies aloud",
    "Dictate",
    "Stop dictation",
    "Listening…",
    "Microphone access denied",
    "Speech recognition needs a network connection",
    "Regenerate",
  ],
  ru: [
    "Копировать",
    "Скопировано",
    "Озвучить",
    "Остановить озвучку",
    "Озвучивать ответы",
    "Диктовка",
    "Остановить диктовку",
    "Слушаю…",
    "Нет доступа к микрофону",
    "Распознаванию нужна сеть",
    "Повторить ответ",
  ],
  es: [
    "Copiar",
    "Copiado",
    "Leer en voz alta",
    "Detener lectura",
    "Leer respuestas en voz alta",
    "Dictar",
    "Detener dictado",
    "Escuchando…",
    "Acceso al micrófono denegado",
    "El reconocimiento de voz necesita conexión",
    "Regenerar",
  ],
  zh: [
    "复制",
    "已复制",
    "朗读",
    "停止朗读",
    "朗读回复",
    "语音输入",
    "停止语音输入",
    "正在听…",
    "麦克风权限被拒绝",
    "语音识别需要网络连接",
    "重新生成",
  ],
  ja: [
    "コピー",
    "コピーしました",
    "読み上げ",
    "読み上げを停止",
    "返信を読み上げ",
    "音声入力",
    "音声入力を停止",
    "聞き取り中…",
    "マイクへのアクセスが拒否されました",
    "音声認識にはネットワークが必要です",
    "再生成",
  ],
  hi: [
    "कॉपी करें",
    "कॉपी हो गया",
    "पढ़कर सुनाएँ",
    "पढ़ना रोकें",
    "उत्तर पढ़कर सुनाएँ",
    "बोलकर लिखें",
    "बोलकर लिखना रोकें",
    "सुन रहा हूँ…",
    "माइक्रोफ़ोन की अनुमति नहीं मिली",
    "वाक् पहचान के लिए नेटवर्क चाहिए",
    "फिर से बनाएँ",
  ],
  pt: [
    "Copiar",
    "Copiado",
    "Ler em voz alta",
    "Parar leitura",
    "Ler respostas em voz alta",
    "Ditar",
    "Parar ditado",
    "Ouvindo…",
    "Acesso ao microfone negado",
    "O reconhecimento de fala precisa de rede",
    "Gerar novamente",
  ],
  de: [
    "Kopieren",
    "Kopiert",
    "Vorlesen",
    "Vorlesen stoppen",
    "Antworten vorlesen",
    "Diktieren",
    "Diktat stoppen",
    "Ich höre zu…",
    "Kein Zugriff auf das Mikrofon",
    "Spracherkennung braucht eine Netzwerkverbindung",
    "Neu generieren",
  ],
  ar: [
    "نسخ",
    "تم النسخ",
    "قراءة بصوت عالٍ",
    "إيقاف القراءة",
    "قراءة الردود بصوت عالٍ",
    "إملاء صوتي",
    "إيقاف الإملاء",
    "أستمع…",
    "تم رفض الوصول إلى الميكروفون",
    "التعرف على الكلام يحتاج إلى اتصال بالشبكة",
    "إعادة التوليد",
  ],
};

const MARKER = "} as const satisfies LocaleMessages;";

for (const [lang, values] of Object.entries(TEXT)) {
  const file = join(root, "src", "i18n", lang, "chat.ts");
  let src = readFileSync(file, "utf8");
  const add = [];
  KEYS.forEach((key, index) => {
    if (src.includes(`"${key}"`)) return;
    add.push(`  "${key}": ${JSON.stringify(values[index])},`);
  });
  if (add.length === 0) {
    console.log("=", lang, "уже полный");
    continue;
  }
  src = src.replace(MARKER, `${add.join("\n")}\n${MARKER}`);
  writeFileSync(file, src);
  console.log("+", lang, add.length);
}
