/**
 * Снимок использования раз в сутки.
 *
 * В GoatCounter уходит только вид факта, не содержимое:
 * язык интерфейса, протокол и модель каждого подключения,
 * по одному событию на обычный и на защищённый (токенный) диалог.
 * Адреса, ключи, названия диалогов и тексты сообщений не отправляются.
 */

import type { Agent, ModelMixConfig, ModelPoolConfig, OpenAIConfig, Session } from "@/storage/types";
import { trackEvent } from "./goatcounter";

const DAY_KEY = "gena.analytics.day";

/** Безопасный кусок пути: латиница, цифры, точка, подчёркивание, дефис. */
export function analyticsSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "unknown";
}

/** Модели, которые реально выбраны у подключения. */
export function modelsOf(agent: Agent): string[] {
  const protocol = agent.protocol ?? "http_json";
  if (protocol === "model_pool") {
    const models = (agent.config as ModelPoolConfig | undefined)?.models ?? [];
    const ids = models.map((model) => model.id.trim()).filter(Boolean);
    return ids.length > 0 ? ids : ["default"];
  }
  if (protocol === "model_mix") {
    const routes = (agent.config as ModelMixConfig | undefined)?.routes ?? [];
    const ids = routes.map((route) => route.model.trim()).filter(Boolean);
    return ids.length > 0 ? ids : ["default"];
  }
  if (protocol === "openai") {
    const model = (agent.config as OpenAIConfig | undefined)?.model?.trim() || agent.settings.llmModel.trim();
    return [model || "default"];
  }
  return [agent.settings.llmModel.trim() || "default"];
}

/**
 * События одного снимка.
 * `chat/plain` и `chat/token` повторяются по числу диалогов — в отчёте это сумма.
 */
export function usageEvents(agents: readonly Agent[], sessions: readonly Session[], locale: string): string[] {
  const events = [`locale/${analyticsSlug(locale)}`];
  for (const session of sessions) {
    events.push(session.tokenMode ? "chat/token" : "chat/plain");
  }
  for (const agent of agents) {
    const protocol = analyticsSlug(agent.protocol ?? "http_json");
    for (const model of modelsOf(agent)) {
      events.push(`provider/${protocol}/${analyticsSlug(model)}`);
    }
  }
  return events;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Отправить снимок, если за эти сутки он ещё не уходил из этого браузера. */
export function reportUsage(
  agents: readonly Agent[],
  sessions: readonly Session[],
  locale: string,
): void {
  let sent = "";
  try {
    sent = localStorage.getItem(DAY_KEY) ?? "";
  } catch {
    sent = "";
  }
  const day = today();
  if (sent === day) return;
  for (const name of usageEvents(agents, sessions, locale)) trackEvent(name);
  try {
    localStorage.setItem(DAY_KEY, day);
  } catch {
    // Приватный режим: снимок уйдёт ещё раз при следующем открытии.
  }
}
