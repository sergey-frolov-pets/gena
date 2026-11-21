/**
 * Очередь моделей для пула одного провайдера и сводки из нескольких.
 *
 * Локальный дневной лимит модели пропускает её до запроса. Ответ 429
 * (лимит на стороне провайдера) переключает на следующую. Галочка
 * «сначала бесплатные» поднимает бесплатные модели с живым лимитом
 * в начало очереди, не меняя порядок внутри каждой группы.
 */

import type { Agent, ModelMixConfig, ModelPoolConfig, PoolModel } from "@/storage/types";
import { toCount } from "@/storage/types";
import type { Message } from "@/storage/types";
import { canCall, recordCall } from "@/storage/usage";
import { AgentClientError } from "./transports/client-error";
import { openaiTransport } from "./transports/openai";
import type { TransportEvents } from "./transports/types";

export interface ModelSlot {
  /** Ключ дневного счётчика. У OpenAI-провайдера совпадает с id агента. */
  usageKey: string;
  model: string;
  free: boolean;
  dailyLimit: number;
  /** Провайдер, чей адрес и ключ уходят в запрос. */
  provider: Agent;
}

export function modelUsageKey(agentId: string, model: string): string {
  return `${agentId}\u0000${model}`;
}

function poolModels(agent: Agent): PoolModel[] {
  const cfg = (agent.config ?? {}) as ModelPoolConfig;
  return Array.isArray(cfg.models) ? cfg.models : [];
}

function poolPrompt(agent: Agent): string | undefined {
  const prompt = (agent.config as ModelPoolConfig | undefined)?.systemPrompt?.trim();
  return prompt || undefined;
}

/** Модель провайдера, если она у него есть. */
function slotFromProvider(provider: Agent, modelId: string): ModelSlot | null {
  const model = modelId.trim();
  if (!model) return null;

  if ((provider.protocol ?? "http_json") === "openai") {
    const own = ((provider.config as { model?: string } | undefined)?.model || provider.settings.llmModel || "").trim();
    if (own !== model) return null;
    return {
      usageKey: provider.id,
      model,
      free: false,
      dailyLimit: toCount(provider.settings.callLimit),
      provider,
    };
  }

  if (provider.protocol === "model_pool") {
    const found = poolModels(provider).find((item) => item.id.trim() === model);
    if (!found) return null;
    return {
      usageKey: modelUsageKey(provider.id, model),
      model,
      free: Boolean(found.free),
      dailyLimit: toCount(found.dailyLimit),
      provider,
    };
  }

  return null;
}

/** Слоты в порядке, заданном в агенте. Пропавшие провайдеры пропускаются. */
export function modelSlots(agent: Agent, peers: Agent[]): ModelSlot[] {
  if (agent.protocol === "model_pool") {
    const slots: ModelSlot[] = [];
    for (const item of poolModels(agent)) {
      const model = item.id.trim();
      if (!model) continue;
      slots.push({
        usageKey: modelUsageKey(agent.id, model),
        model,
        free: Boolean(item.free),
        dailyLimit: toCount(item.dailyLimit),
        provider: agent,
      });
    }
    return slots;
  }

  if (agent.protocol === "model_mix") {
    const routes = ((agent.config ?? {}) as ModelMixConfig).routes ?? [];
    const slots: ModelSlot[] = [];
    for (const route of routes) {
      const provider = peers.find((peer) => peer.id === route.agentId);
      if (!provider || provider.id === agent.id) continue;
      const slot = slotFromProvider(provider, route.model);
      if (slot) slots.push(slot);
    }
    return slots;
  }

  return [];
}

export function prefersFree(agent: Agent): boolean {
  const cfg = (agent.config ?? {}) as { preferFree?: boolean };
  return Boolean(cfg.preferFree);
}

/**
 * Открытые слоты. При `preferFree` бесплатные идут первыми,
 * относительный порядок внутри группы сохраняется.
 */
export function orderSlots(slots: ModelSlot[], preferFree: boolean, open: (slot: ModelSlot) => boolean): ModelSlot[] {
  const usable = slots.filter(open);
  if (!preferFree) return usable;
  return [...usable.filter((slot) => slot.free), ...usable.filter((slot) => !slot.free)];
}

/** Есть ли хотя бы одна модель с неиспользованным дневным лимитом. */
export async function hasOpenSlot(agent: Agent, peers: Agent[]): Promise<boolean> {
  for (const slot of modelSlots(agent, peers)) {
    if (await canCall(slot.usageKey, slot.dailyLimit)) return true;
  }
  return false;
}

function asOpenai(provider: Agent, model: string, systemPrompt?: string): Agent {
  return {
    ...provider,
    protocol: "openai",
    config: {
      model,
      systemPrompt: systemPrompt ?? (provider.config as { systemPrompt?: string } | undefined)?.systemPrompt,
    },
  };
}

function isRateLimit(error: unknown): boolean {
  return error instanceof AgentClientError && error.status === 429;
}

export interface FallbackRequest {
  message: string;
  media?: string[];
  sessionId: string;
  history: Message[];
}

export interface FallbackOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  events?: TransportEvents;
  openKey: (provider: Agent) => Promise<string>;
}

export async function sendModelFallback(
  agent: Agent,
  apiKey: string,
  peers: Agent[],
  request: FallbackRequest,
  options: FallbackOptions,
): Promise<{ reply: string; model: string }> {
  const slots = modelSlots(agent, peers);
  const open: ModelSlot[] = [];
  for (const slot of slots) {
    if (await canCall(slot.usageKey, slot.dailyLimit)) open.push(slot);
  }
  const queue = orderSlots(open, prefersFree(agent), () => true);
  if (queue.length === 0) {
    throw new AgentClientError("model fallback exhausted", 429);
  }

  const prompt = agent.protocol === "model_pool" ? poolPrompt(agent) : undefined;
  let lastLimit: unknown;
  for (const slot of queue) {
    const key = slot.provider.id === agent.id ? apiKey : await options.openKey(slot.provider);
    let streamed = false;
    const events: TransportEvents = {
      ...options.events,
      onDelta: (id, chunk) => {
        streamed = true;
        options.events?.onDelta?.(id, chunk);
      },
    };
    try {
      const response = await openaiTransport.send(
        {
          agent: asOpenai(slot.provider, slot.model, prompt),
          apiKey: key,
          sessionId: request.sessionId,
          message: request.message,
          media: request.media,
          history: request.history,
          signal: options.signal ?? new AbortController().signal,
          fetchImpl: options.fetchImpl ?? fetch,
        },
        events,
      );
      await recordCall(slot.usageKey);
      return { ...response, model: slot.model };
    } catch (error) {
      if (isRateLimit(error) && !streamed) {
        lastLimit = error;
        continue;
      }
      throw error;
    }
  }
  throw lastLimit ?? new AgentClientError("model fallback exhausted", 429);
}
