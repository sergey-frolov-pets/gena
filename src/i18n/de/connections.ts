import type { LocaleMessages } from "../types";

export const connectionsMessages = {
  "connections.title": "Agentenverbindungen",
  "connections.intro":
    "Der Agentenschlüssel wird verschlüsselt im Browser gespeichert (AES-GCM, der Schlüssel bleibt auf diesem Gerät). Schlüssel gelangen nie in Backups.",
  "connections.newAgent": "Neuer Agent",
  "connections.field.name": "Name",
  "connections.field.namePlaceholder": "Mein Agent",
  "connections.field.address": "Adresse (URL-Endpunkt)",
  "connections.field.addressPlaceholder": "https://agent.example.com/chat",
  "connections.field.key": "Schlüssel (Bearer-Token)",
  "connections.field.keyPlaceholder": "geheim",
  "connections.field.contextSize": "Kontextgröße (Nachrichten)",
  "connections.field.callLimit": "Aufrufe pro Tag (0 — kein Limit)",
  "connections.field.llmModel": "LLM-Modell",
  "connections.field.llmModelPlaceholder": "z. B. gpt-4o-mini",
  "connections.add": "Hinzufügen",
  "connections.added": "Agent hinzugefügt",
  "connections.missingFields": "Name und Adresse des Agenten angeben",
  "connections.list": "Agenten",
  "connections.empty": "Noch keine Agenten.",
  "connections.remove": "Löschen",
  "connections.summary": "Kontext: {contextSize} · Aufrufe/Tag: {callLimit} · Modell: {model}",
  "connections.keySaved": "Schlüssel gespeichert — neuen eingeben, um ihn zu ersetzen",
  "connections.keyMissing": "kein Schlüssel gesetzt",
  "connections.saveKey": "Schlüssel speichern",
  "connections.keyUpdated": "Schlüssel aktualisiert",
} as const satisfies LocaleMessages;
