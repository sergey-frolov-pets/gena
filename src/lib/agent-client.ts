/**
 * Клиент агента: POST {message, sessionId, settings} -> {reply}.
 *
 * Ключ агента передаётся в Authorization: Bearer. Ключ берётся из
 * распечатанного sealedKey в момент запроса — в памяти, не в бэкапе.
 */

import type { Agent, AgentSettings, Message } from "@/storage/types";

export interface AgentRequest {
  message: string;
  sessionId: string;
  settings: AgentSettings;
  /** Последние сообщения как контекст (обрезается по settings.contextSize). */
  history: Message[];
}

export interface AgentResponse {
  reply: string;
}

/**
 * Код ошибки клиента. UI переводит код в текст через i18n,
 * поэтому сообщение не зависит от языка.
 */
export type AgentClientErrorCode = "no_address" | "network" | "not_json" | "no_reply";

export class AgentClientError extends Error {
  readonly status?: number;
  readonly code?: AgentClientErrorCode;
  /** Сырой текст сетевой ошибки — подставляется в переведённый шаблон. */
  readonly detail?: string;

  constructor(message: string, status?: number, code?: AgentClientErrorCode, detail?: string) {
    super(message);
    this.name = "AgentClientError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

/** Обрезать историю до contextSize последних сообщений. */
export function trimHistory(history: Message[], contextSize: number): Message[] {
  if (contextSize <= 0) {
    return [];
  }
  return history.slice(-contextSize);
}

export async function sendToAgent(
  agent: Agent,
  apiKey: string,
  request: AgentRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<AgentResponse> {
  if (!agent.address) {
    throw new AgentClientError("agent address is not set", undefined, "no_address");
  }

  const body = {
    message: request.message,
    sessionId: request.sessionId,
    settings: request.settings,
    history: trimHistory(request.history, request.settings.contextSize).map((m) => ({
      role: m.role,
      content: m.content,
    })),
  };

  let response: Response;
  try {
    response = await fetchImpl(agent.address, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AgentClientError(`could not reach the agent: ${detail}`, undefined, "network", detail);
  }

  if (!response.ok) {
    throw new AgentClientError(`agent responded ${response.status}`, response.status);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new AgentClientError("agent returned a non-JSON response", undefined, "not_json");
  }

  if (typeof data !== "object" || data === null || typeof (data as { reply?: unknown }).reply !== "string") {
    throw new AgentClientError("agent response has no reply field", undefined, "no_reply");
  }

  return { reply: (data as { reply: string }).reply };
}
