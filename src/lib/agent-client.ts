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

export class AgentClientError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "AgentClientError";
    this.status = status;
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
    throw new AgentClientError("у агента не задан адрес");
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
    throw new AgentClientError(
      `не удалось связаться с агентом: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) {
    throw new AgentClientError(`агент ответил ${response.status}`, response.status);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new AgentClientError("агент вернул не-JSON ответ");
  }

  if (typeof data !== "object" || data === null || typeof (data as { reply?: unknown }).reply !== "string") {
    throw new AgentClientError("в ответе агента нет поля reply");
  }

  return { reply: (data as { reply: string }).reply };
}
