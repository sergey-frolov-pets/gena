import type { LocaleMessages } from "../types";

export const connectionsMessages = {
  "connections.title": "Agent connections",
  "connections.intro":
    "The agent key is stored in your browser encrypted (AES-GCM, key stays on this device). Keys never go into backups.",
  "connections.newAgent": "New agent",
  "connections.field.name": "Name",
  "connections.field.namePlaceholder": "My agent",
  "connections.field.address": "Address (URL endpoint)",
  "connections.field.addressPlaceholder": "https://agent.example.com/chat",
  "connections.field.key": "Key (Bearer token)",
  "connections.field.keyPlaceholder": "secret",
  "connections.field.contextSize": "Context size (messages)",
  "connections.field.callLimit": "Calls per day (0 — no limit)",
  "connections.field.llmModel": "LLM model",
  "connections.field.llmModelPlaceholder": "e.g. gpt-4o-mini",
  "connections.add": "Add",
  "connections.added": "Agent added",
  "connections.missingFields": "Enter the agent name and address",
  "connections.list": "Agents",
  "connections.empty": "No agents yet.",
  "connections.remove": "Delete",
  "connections.summary": "context: {contextSize} · calls/day: {callLimit} · model: {model}",
  "connections.keySaved": "key saved — enter a new one to replace it",
  "connections.keyMissing": "no key set",
  "connections.saveKey": "Save key",
  "connections.keyUpdated": "Key updated",
} as const satisfies LocaleMessages;
