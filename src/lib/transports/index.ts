/**
 * Реестр транспортов по протоколу агента.
 */

import type { Agent } from "@/storage/types";
import { HTTP_CAPABILITIES } from "./capabilities";
import { httpJsonTransport } from "./http-json";
import { openaiTransport } from "./openai";
import { picoTransport } from "./pico-ws";
import type { AgentTransport, TransportCapabilities } from "./types";

export type {
  AgentTransport,
  TransportEvents,
  TransportMessage,
  TransportRequest,
} from "./types";
export { AgentClientError, type AgentClientErrorCode } from "./client-error";

/** Выбрать транспорт по `agent.protocol` (нет поля → `http_json`). */
export function capabilitiesOf(agent: Agent | undefined): TransportCapabilities {
  if (!agent) return HTTP_CAPABILITIES;
  return getTransport(agent).capabilities;
}

export function getTransport(agent: Agent): AgentTransport {
  switch (agent.protocol ?? "http_json") {
    case "openai":
    case "model_pool":
    case "model_mix":
      return openaiTransport;
    case "pico_ws":
      return picoTransport;
    case "http_json":
    default:
      return httpJsonTransport;
  }
}
