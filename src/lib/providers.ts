/** Сервисы с OpenAI-совместимым chat API, которые можно вставить в «Подключения». */
export type ProviderHint = "cloud" | "router" | "local";

export type ConnectableProvider = {
  id: string;
  name: string;
  site: string;
  baseUrl: string;
  hint: ProviderHint;
};

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
    id: "openrouter",
    name: "OpenRouter",
    site: "https://openrouter.ai",
    baseUrl: "https://openrouter.ai/api/v1",
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
