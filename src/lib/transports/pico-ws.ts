/**
 * Транспорт `pico_ws` — WebSocket-канал Pico.
 *
 * Auth — subprotocol `token.<token>`; `session_id` — query-параметр при коннекте
 * (история не шлётся: сервер хранит контекст по session_id).
 *
 * Конец хода: `typing.stop` после ≥1 финального `message.create` (без `kind`).
 * Запасные варианты: 3 с тишины после финального сообщения и жёсткий таймаут 120 с.
 */

import { newId } from "@/lib/id";
import type { PicoConfig } from "@/storage/types";
import { AgentClientError } from "./client-error";
import { PicoConnection, type PicoFrame, type PicoSocketCtor } from "./pico-connection";
import type { AgentTransport, TransportEvents, TransportRequest } from "./types";

const HARD_TIMEOUT_MS = 120_000;
const SILENCE_TIMEOUT_MS = 3_000;
const CONNECT_ATTEMPTS = 3;
const CONNECT_BACKOFF_MS = 1_000;

export function buildWsUrl(address: string, sessionId: string): string {
  let url = address.trim();
  if (!url.includes("/pico/ws")) {
    url = url.replace(/\/+$/, "") + "/pico/ws";
  }
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}session_id=${encodeURIComponent(sessionId)}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function makePicoTransport(ctor?: PicoSocketCtor): AgentTransport {
  const resolveCtor = (): PicoSocketCtor => {
    if (ctor) {
      return ctor;
    }
    const ws = (globalThis as { WebSocket?: PicoSocketCtor }).WebSocket;
    if (!ws) {
      throw new AgentClientError(
        "WebSocket is not available in this environment",
        undefined,
        "ws_connect",
      );
    }
    return ws;
  };

  return {
    async send(req: TransportRequest, ev: TransportEvents): Promise<{ reply: string }> {
      const agent = req.agent;
      if (!agent.address) {
        throw new AgentClientError("agent address is not set", undefined, "no_address");
      }

      const socketCtor = resolveCtor();
      const cfg = (agent.config ?? {}) as PicoConfig;
      const maxAttempts = cfg.reconnect === false ? 1 : CONNECT_ATTEMPTS;
      const url = buildWsUrl(agent.address, req.sessionId);
      const conn = new PicoConnection(socketCtor);

      return new Promise<{ reply: string }>((resolve, reject) => {
        let reply: string | null = null;
        let settled = false;
        let silenceTimer: ReturnType<typeof setTimeout> | null = null;

        const hardTimer = setTimeout(() => {
          finish(reject, new AgentClientError("no response from agent", undefined, "ws_timeout"));
        }, HARD_TIMEOUT_MS);

        function clearTimers(): void {
          clearTimeout(hardTimer);
          if (silenceTimer) {
            clearTimeout(silenceTimer);
          }
        }

        function finish<T>(fn: (value: T) => void, value: T): void {
          if (settled) {
            return;
          }
          settled = true;
          clearTimers();
          conn.close();
          fn(value);
        }

        function resetSilence(): void {
          if (silenceTimer) {
            clearTimeout(silenceTimer);
          }
          silenceTimer = setTimeout(() => {
            if (reply !== null) {
              finish(resolve, { reply });
            }
          }, SILENCE_TIMEOUT_MS);
        }

        const onAbort = () => {
          finish(reject, new AgentClientError("request aborted", undefined, "network", "aborted"));
        };
        if (req.signal) {
          req.signal.addEventListener("abort", onAbort);
        }

        conn.setHandlers({
          onMessage(frame: PicoFrame) {
            const type = frame.type;
            const payload = frame.payload ?? {};

            if (type === "typing.start") {
              ev.onTyping?.(true);
              return;
            }
            if (type === "typing.stop") {
              ev.onTyping?.(false);
              if (reply !== null) {
                finish(resolve, { reply });
              }
              return;
            }
            if (type === "error") {
              const code = typeof payload.code === "string" ? payload.code : undefined;
              const msg = typeof payload.message === "string" ? payload.message : "agent error";
              finish(reject, new AgentClientError(msg, undefined, "pico_error", code));
              return;
            }
            if (type === "message.create") {
              const kind = payload.kind;
              const content = typeof payload.content === "string" ? payload.content : "";
              if (kind === "thought" || kind === "tool_calls") {
                ev.onMessage?.({
                  id: String(payload.message_id ?? ""),
                  kind,
                  content,
                  model: typeof payload.model_name === "string" ? payload.model_name : undefined,
                  usage: payload.usage,
                });
                return;
              }
              reply = content;
              resetSilence();
            }
          },
          onClose() {
            if (settled) {
              return;
            }
            if (reply !== null) {
              finish(resolve, { reply });
              return;
            }
            finish(reject, new AgentClientError("connection closed", undefined, "ws_closed"));
          },
        });

        void (async () => {
          let lastErr: unknown = null;
          for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if (settled) {
              return;
            }
            try {
              await conn.connect(url, req.apiKey);
              conn.send({
                type: "message.send",
                id: newId(),
                timestamp: Date.now(),
                payload: { content: req.message },
              });
              return;
            } catch (err) {
              lastErr = err;
              if (attempt < maxAttempts - 1) {
                await delay(CONNECT_BACKOFF_MS * 2 ** attempt);
              }
            }
          }
          if (!settled) {
            const detail = lastErr instanceof Error ? lastErr.message : String(lastErr);
            finish(reject, new AgentClientError("could not connect", undefined, "ws_connect", detail));
          }
        })();
      });
    },
    dispose() {
      // Соединение открывается на каждый ход и закрывается по завершении.
    },
  };
}

export const picoTransport = makePicoTransport();
