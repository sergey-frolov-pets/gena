/**
 * Транспорт `openai` — OpenAI-совместимый REST (`/chat/completions`).
 *
 * `address` — base URL (например `https://api.openai.com/v1`), `sealedKey` —
 * Bearer-ключ, `config` (OpenAIConfig) — model/systemPrompt/temperature.
 *
 * Запрос уходит со `stream: true`; SSE-ответ читается инкрементально, куски
 * текста эмитятся через `ev.onDelta`. Если сервер игнорирует `stream` и
 * возвращает обычный JSON — ответ разбирается прежним способом.
 */

import { newId } from "@/lib/id";
import type { OpenAIConfig } from "@/storage/types";
import { OPENAI_CAPABILITIES } from "./capabilities";
import { AgentClientError } from "./client-error";
import { contextMessages, toWireMessage, trimHistory } from "./history";
import type { AgentTransport, TransportEvents, TransportRequest } from "./types";

function extractContent(data: unknown): string | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }
  const first = choices[0] as { message?: { content?: unknown } } | undefined;
  const content = first?.message?.content;
  return typeof content === "string" && content.length > 0 ? content : null;
}

/** Расход токенов из полного JSON или последнего SSE-чанка. */
export function extractUsage(data: unknown): Record<string, unknown> | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const usage = (data as { usage?: unknown }).usage;
  if (typeof usage !== "object" || usage === null) return undefined;
  const row = usage as Record<string, unknown>;
  const prompt = row.prompt_tokens ?? row.input_tokens;
  const completion = row.completion_tokens ?? row.output_tokens;
  if (typeof prompt !== "number" && typeof completion !== "number") return undefined;
  return row;
}

/** Достать кусок текста из SSE-события (`delta.content`) или полного ответа (`message.content`). */
export function extractSseDelta(data: unknown): string | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }
  const first = choices[0] as
    | { delta?: { content?: unknown }; message?: { content?: unknown } }
    | undefined;
  const content = first?.delta?.content ?? first?.message?.content;
  return typeof content === "string" && content.length > 0 ? content : null;
}

/** Разобрать одно SSE-событие (строки до пустой строки) → JSON или null. */
export function parseSseEvent(raw: string): unknown | null {
  const dataLines: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) {
    return null;
  }
  const payload = dataLines.join("\n");
  if (payload === "[DONE]") {
    return null;
  }
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

/** Разобрать полный SSE-текст в список событий (для тестов и фолбэка без стрима). */
export function parseSseEvents(text: string): unknown[] {
  const events: unknown[] = [];
  for (const raw of text.split(/\r?\n\r?\n/)) {
    const data = parseSseEvent(raw);
    if (data !== null) {
      events.push(data);
    }
  }
  return events;
}

async function readSseStream(
  response: Response,
  onEvent: (data: unknown) => void,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) {
    // Нет читаемого потока (например, в части тестовых окружений) — читаем целиком.
    const text = await response.text();
    for (const data of parseSseEvents(text)) {
      onEvent(data);
    }
    return;
  }
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const data = parseSseEvent(raw);
      if (data !== null) {
        onEvent(data);
      }
    }
  }
  const tail = parseSseEvent(buffer);
  if (tail !== null) {
    onEvent(tail);
  }
}

export const openaiTransport: AgentTransport = {
  capabilities: OPENAI_CAPABILITIES,
  async send(req: TransportRequest, ev: TransportEvents): Promise<{ reply: string }> {
    const agent = req.agent;
    if (!agent.address) {
      throw new AgentClientError("agent address is not set", undefined, "no_address");
    }

    const cfg = (agent.config ?? {}) as OpenAIConfig;
    const url = `${agent.address.replace(/\/+$/, "")}/chat/completions`;

    const messages: Array<{ role: string; content: string }> = [];
    if (cfg.systemPrompt) {
      messages.push({ role: "system", content: cfg.systemPrompt });
    }
    const ctx = trimHistory(contextMessages(req.history), agent.settings.contextSize);
    messages.push(...ctx.map(toWireMessage));
    messages.push({ role: "user", content: req.message });

    const body: Record<string, unknown> = {
      model: cfg.model || agent.settings.llmModel || "",
      messages,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (cfg.temperature !== undefined) {
      body.temperature = cfg.temperature;
    }

    const fetchImpl = req.fetchImpl ?? fetch;

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(req.apiKey ? { Authorization: `Bearer ${req.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: req.signal,
      });
    } catch (error) {
      if (req.signal?.aborted) {
        throw new AgentClientError("request aborted", undefined, "network", "aborted");
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new AgentClientError(`could not reach the agent: ${detail}`, undefined, "network", detail);
    }

    if (!response.ok) {
      throw new AgentClientError(`agent responded ${response.status}`, response.status);
    }

    const contentType = response.headers.get("content-type") ?? "";

    // SSE-стрим: читаем инкрементально и эмитим дельты.
    if (contentType.includes("text/event-stream")) {
      const streamId = newId("stream");
      let acc = "";
      let usage: Record<string, unknown> | undefined;
      let streamError: string | null = null;
      await readSseStream(response, (data) => {
        const err = (data as { error?: { message?: unknown } } | null)?.error;
        if (err && typeof err.message === "string") {
          streamError = err.message;
          return;
        }
        usage = extractUsage(data) ?? usage;
        const delta = extractSseDelta(data);
        if (delta) {
          acc += delta;
          ev.onDelta?.(streamId, delta);
        }
      });
      if (streamError) {
        throw new AgentClientError(streamError, undefined, "openai_error", streamError);
      }
      if (!acc) {
        throw new AgentClientError("agent returned an empty or invalid response", undefined, "openai_empty");
      }
      return { reply: acc, ...(usage ? { usage } : {}) };
    }

    // Фолбэк: сервер проигнорировал `stream` и вернул обычный JSON.
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new AgentClientError("agent returned a non-JSON response", undefined, "not_json");
    }

    const content = extractContent(data);
    if (content === null) {
      throw new AgentClientError("agent returned an empty or invalid response", undefined, "openai_empty");
    }

    const usage = extractUsage(data);
    return { reply: content, ...(usage ? { usage } : {}) };
  },
};
