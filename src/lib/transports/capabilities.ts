import type { TransportCapabilities } from "./types";

export const HTTP_CAPABILITIES: TransportCapabilities = {
  media: false,
  stream: false,
  resume: false,
  cancel: false,
  tools: false,
  llm: false,
};

export const OPENAI_CAPABILITIES: TransportCapabilities = {
  media: false,
  stream: true,
  resume: false,
  cancel: false,
  tools: false,
  llm: true,
};

export const PICO_CAPABILITIES: TransportCapabilities = {
  media: true,
  stream: true,
  resume: true,
  cancel: true,
  tools: true,
  llm: false,
};
