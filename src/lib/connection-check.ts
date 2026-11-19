/**
 * Быстрая проверка подключения к агенту («Проверить подключение»).
 *
 * Не отправляет полноценный ход: для REST — минимальный запрос, для Pico —
 * открытие WebSocket с авторизацией. Результат — `{ ok }` либо `{ ok: false,
 * error }`, где error передаётся в `describeError` для локализации.
 */

import type { Agent, OpenAIConfig } from "@/storage/types";
import { AgentClientError } from "./transports/client-error";
import { PicoConnection, type PicoSocketCtor } from "./transports/pico-connection";
import { buildWsUrl } from "./transports/pico-ws";

const CHECK_TIMEOUT_MS = 10_000;

export interface ConnectionCheckResult {
  ok: boolean;
  error?: unknown;
}

function timeoutSignal(): { signal: AbortSignal; cleanup: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT_MS);
  return { signal: ctrl.signal, cleanup: () => clearTimeout(timer) };
}

function wsCtor(): PicoSocketCtor {
  const ws = (globalThis as { WebSocket?: PicoSocketCtor }).WebSocket;
  if (!ws) {
    throw new AgentClientError("WebSocket is not available in this environment", undefined, "ws_connect");
  }
  return ws;
}

async function checkOpenai(agent: Agent, apiKey: string, fetchImpl: typeof fetch): Promise<void> {
  const cfg = (agent.config ?? {}) as OpenAIConfig;
  const url = `${agent.address.replace(/\/+$/, "")}/chat/completions`;
  const { signal, cleanup } = timeoutSignal();
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: cfg.model || agent.settings.llmModel || "",
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: false,
      }),
      signal,
    });
    if (!res.ok) {
      throw new AgentClientError(`agent responded ${res.status}`, res.status);
    }
    const data = (await res.json()) as { choices?: unknown };
    if (!Array.isArray(data.choices) || data.choices.length === 0) {
      throw new AgentClientError("agent returned an empty response", undefined, "openai_empty");
    }
  } finally {
    cleanup();
  }
}

async function checkHttpJson(agent: Agent, apiKey: string, fetchImpl: typeof fetch): Promise<void> {
  const { signal, cleanup } = timeoutSignal();
  try {
    const res = await fetchImpl(agent.address, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        message: "",
        sessionId: "__gena_check__",
        settings: agent.settings,
        history: [],
      }),
      signal,
    });
    if (!res.ok) {
      throw new AgentClientError(`agent responded ${res.status}`, res.status);
    }
  } finally {
    cleanup();
  }
}

async function checkPico(agent: Agent, apiKey: string): Promise<void> {
  const conn = new PicoConnection(wsCtor());
  const url = buildWsUrl(agent.address, "__gena_check__");
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      conn.connect(url, apiKey),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new AgentClientError("connection timed out", undefined, "ws_timeout")),
          CHECK_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    conn.close();
  }
}

/** Проверить, что агент доступен и авторизация работает. */
export async function checkConnection(
  agent: Agent,
  apiKey: string,
  fetchImpl?: typeof fetch,
): Promise<ConnectionCheckResult> {
  const protocol = agent.protocol ?? "http_json";
  try {
    if (protocol === "pico_ws") {
      await checkPico(agent, apiKey);
    } else if (protocol === "openai") {
      await checkOpenai(agent, apiKey, fetchImpl ?? fetch);
    } else {
      await checkHttpJson(agent, apiKey, fetchImpl ?? fetch);
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}
