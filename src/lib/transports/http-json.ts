/**
 * Транспорт `http_json` — прежний протокол Gena.
 *
 * POST {message, sessionId, settings, history} -> {reply}.
 * Поведение не менялось: перенесено из старого agent-client.ts.
 */

import { AgentClientError } from "./client-error";
import { toWireMessage, trimHistory } from "./history";
import { HTTP_CAPABILITIES } from "./capabilities";
import type { AgentTransport, TransportEvents, TransportRequest } from "./types";

export const httpJsonTransport: AgentTransport = {
  capabilities: HTTP_CAPABILITIES,
  async send(req: TransportRequest, _ev: TransportEvents): Promise<{ reply: string }> {
    const agent = req.agent;
    if (!agent.address) {
      throw new AgentClientError("agent address is not set", undefined, "no_address");
    }

    const body = {
      message: req.message,
      sessionId: req.sessionId,
      settings: agent.settings,
      history: trimHistory(req.history, agent.settings.contextSize).map(toWireMessage),
    };

    const fetchImpl = req.fetchImpl ?? fetch;

    let response: Response;
    try {
      response = await fetchImpl(agent.address, {
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

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new AgentClientError("agent returned a non-JSON response", undefined, "not_json");
    }

    if (
      typeof data !== "object" ||
      data === null ||
      typeof (data as { reply?: unknown }).reply !== "string"
    ) {
      throw new AgentClientError("agent response has no reply field", undefined, "no_reply");
    }

    return { reply: (data as { reply: string }).reply };
  },
};
