/** Сервисы с OpenAI-совместимым chat API, которые можно вставить в «Подключения». */
export type ProviderHint = "cloud" | "router" | "local";

export type ConnectableProvider = {
  id: string;
  name: string;
  site: string;
  baseUrl: string;
  hint: ProviderHint;
};

/** Агенты с собственным шлюзом, который Gena умеет вызвать из браузера. */
export type ConnectableAgent = {
  id: string;
  name: string;
  site: string;
  docs: string;
  /** Протокол в форме «Подключения». */
  protocol: "openai" | "pico_ws";
  address: string;
  model: string;
};

export const connectableAgents: ConnectableAgent[] = [
  {
    id: "picoclaw",
    name: "PicoClaw",
    site: "https://github.com/sipeed/picoclaw",
    docs: "https://docs.picoclaw.io/docs/configuration/token_authentication/",
    protocol: "pico_ws",
    address: "ws://127.0.0.1:18790",
    model: "",
  },
  {
    id: "openclaw",
    name: "OpenClaw",
    site: "https://docs.openclaw.ai",
    docs: "https://docs.openclaw.ai/gateway/openai-http-api",
    protocol: "openai",
    address: "http://127.0.0.1:18789/v1",
    model: "openclaw/default",
  },
  {
    id: "hermes",
    name: "Hermes",
    site: "https://hermes-agent.nousresearch.com",
    docs: "https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server",
    protocol: "openai",
    address: "http://127.0.0.1:8642/v1",
    model: "hermes-agent",
  },
];

/** Провайдер с тем же base URL, без завершающего слэша. */
export function providerByBaseUrl(address: string): ConnectableProvider | undefined {
  const norm = address.trim().replace(/\/+$/, "").toLowerCase();
  if (!norm) return undefined;
  return connectableProviders.find((item) => item.baseUrl.replace(/\/+$/, "").toLowerCase() === norm);
}

export const connectableProviders: ConnectableProvider[] = [
  {
    id: "openai",
    name: "OpenAI",
    site: "https://platform.openai.com",
    baseUrl: "https://api.openai.com/v1",
    hint: "cloud",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    site: "https://aistudio.google.com",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    hint: "cloud",
  },
  {
    id: "kimi",
    name: "Kimi",
    site: "https://platform.kimi.ai",
    baseUrl: "https://api.moonshot.ai/v1",
    hint: "cloud",
  },
  {
    id: "zai",
    name: "Z.ai",
    site: "https://z.ai",
    baseUrl: "https://api.z.ai/api/paas/v4",
    hint: "cloud",
  },
  {
    id: "qwen",
    name: "Qwen",
    site: "https://modelstudio.console.alibabacloud.com",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    hint: "cloud",
  },
  {
    id: "minimax",
    name: "MiniMax",
    site: "https://www.minimax.io",
    baseUrl: "https://api.minimax.io/v1",
    hint: "cloud",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    site: "https://openrouter.ai",
    baseUrl: "https://openrouter.ai/api/v1",
    hint: "router",
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    site: "https://huggingface.co/settings/tokens",
    baseUrl: "https://router.huggingface.co/v1",
    hint: "router",
  },
  {
    id: "yandex",
    name: "Yandex AI",
    site: "https://aistudio.yandex.ru",
    baseUrl: "https://ai.api.cloud.yandex.net/v1",
    hint: "cloud",
  },
  {
    id: "gigachat",
    name: "GigaChat",
    site: "https://developers.sber.ru/studio",
    baseUrl: "https://gigachat.devices.sberbank.ru/api/v1",
    hint: "cloud",
  },
  {
    id: "cloudru",
    name: "Cloud.ru",
    site: "https://cloud.ru",
    baseUrl: "https://foundation-models.api.cloud.ru/v1",
    hint: "cloud",
  },
  {
    id: "vsegpt",
    name: "VseGPT",
    site: "https://vsegpt.ru",
    baseUrl: "https://api.vsegpt.ru/v1",
    hint: "router",
  },
  {
    id: "groq",
    name: "Groq",
    site: "https://console.groq.com",
    baseUrl: "https://api.groq.com/openai/v1",
    hint: "cloud",
  },
  {
    id: "mistral",
    name: "Mistral",
    site: "https://console.mistral.ai",
    baseUrl: "https://api.mistral.ai/v1",
    hint: "cloud",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    site: "https://platform.deepseek.com",
    baseUrl: "https://api.deepseek.com",
    hint: "cloud",
  },
  {
    id: "xai",
    name: "xAI",
    site: "https://console.x.ai",
    baseUrl: "https://api.x.ai/v1",
    hint: "cloud",
  },
  {
    id: "cerebras",
    name: "Cerebras",
    site: "https://cloud.cerebras.ai",
    baseUrl: "https://api.cerebras.ai/v1",
    hint: "cloud",
  },
  {
    id: "fireworks",
    name: "Fireworks",
    site: "https://fireworks.ai",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    hint: "cloud",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    site: "https://www.perplexity.ai/settings/api",
    baseUrl: "https://api.perplexity.ai",
    hint: "cloud",
  },
  {
    id: "together",
    name: "Together",
    site: "https://www.together.ai",
    baseUrl: "https://api.together.xyz/v1",
    hint: "cloud",
  },
  {
    id: "ollama",
    name: "Ollama",
    site: "https://ollama.com",
    baseUrl: "http://127.0.0.1:11434/v1",
    hint: "local",
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    site: "https://lmstudio.ai",
    baseUrl: "http://127.0.0.1:1234/v1",
    hint: "local",
  },
];
