/**
 * Транспорт `gena_server` — чат через собственный Gena-сервер.
 *
 * Запрос уходит на `POST {address}/api/agents/{agentId}/chat` с токеном
 * сервера. Ключ провайдера хранится на сервере, устройство его не видит;
 * ответ приходит тем же SSE-потоком, что и от OpenAI.
 */

import { newId } from "@/lib/id";
import type { ServerAgentConfig } from "@/storage/types";
import { AgentClientError } from "./client-error";
import { contextMessages, toWireMessage, trimHistory } from "./history";
import { extractSseDelta, extractUsage, parseSseEvents, readSseStream } from "./openai";
import type { AgentTransport, TransportEvents, TransportRequest } from "./types";

export const GENA_SERVER_CAPABILITIES = {
  media: false,
  stream: true,
  resume: false,
  cancel: false,
  tools: false,
  llm: true,
} as const;

export function chatUrl(baseUrl: string, agentId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/agents/${encodeURIComponent(agentId)}/chat`;
}

async function readErrorDetail(response: Response): Promise<string | undefined> {
  const text = await response.text().catch(() => "");
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    const data = JSON.parse(trimmed) as { error?: unknown };
    if (typeof data?.error === "string" && data.error.trim()) {
      return data.error.trim().slice(0, 400);
    }
  } catch {
    // Не JSON — отдаём как есть, но коротко.
  }
  return trimmed.slice(0, 400);
}

export const genaServerTransport: AgentTransport = {
  capabilities: GENA_SERVER_CAPABILITIES,
  async send(req: TransportRequest, ev: TransportEvents): Promise<{ reply: string }> {
    const agent = req.agent;
    const cfg = (agent.config ?? {}) as ServerAgentConfig;
    if (!agent.address) {
      throw new AgentClientError("agent address is not set", undefined, "no_address");
    }
    if (!cfg.agentId) {
      throw new AgentClientError("server agent id is not set", undefined, "no_address");
    }

    const messages: Array<{ role: string; content: string }> = [];
    const ctx = trimHistory(contextMessages(req.history), agent.settings.contextSize);
    messages.push(...ctx.map(toWireMessage));
    messages.push({ role: "user", content: req.message });

    const fetchImpl = req.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await fetchImpl(chatUrl(agent.address, cfg.agentId), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(req.apiKey ? { Authorization: `Bearer ${req.apiKey}` } : {}),
        },
        body: JSON.stringify({ messages, stream: true }),
        signal: req.signal,
      });
    } catch (error) {
      if (req.signal?.aborted) {
        throw new AgentClientError("request aborted", undefined, "network", "aborted");
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new AgentClientError(`could not reach the server: ${detail}`, undefined, "network", detail);
    }

    if (!response.ok) {
      const detail = await readErrorDetail(response);
      throw new AgentClientError(
        detail ? `server responded ${response.status}: ${detail}` : `server responded ${response.status}`,
        response.status,
        detail ? "openai_error" : undefined,
        detail,
      );
    }

    const contentType = response.headers.get("content-type") ?? "";

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
        throw new AgentClientError("server returned an empty or invalid response", undefined, "openai_empty");
      }
      return { reply: acc, ...(usage ? { usage } : {}) };
    }

    // Сервер ответил обычным JSON (стрим выключен или прокси срезал поток).
    const text = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new AgentClientError("server returned a non-JSON response", undefined, "not_json");
    }
    const choices = (data as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
    const content = choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content) {
      throw new AgentClientError("server returned an empty or invalid response", undefined, "openai_empty");
    }
    const usage = extractUsage(data);
    return { reply: content, ...(usage ? { usage } : {}) };
  },
};

/** Разобрать текст ответа целиком — нужно тестам и фолбэку без потока. */
export function parseServerReply(text: string): string {
  let acc = "";
  for (const data of parseSseEvents(text)) {
    const delta = extractSseDelta(data);
    if (delta) acc += delta;
  }
  return acc;
}
