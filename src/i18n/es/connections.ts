import type { LocaleMessages } from "../types";

export const connectionsMessages = {
  "connections.title": "Conexiones con agentes",
  "connections.intro":
    "La clave del agente se guarda cifrada en tu navegador (AES-GCM, la clave se queda en este dispositivo). Las claves nunca entran en las copias de seguridad.",
  "connections.newAgent": "Nuevo agente",
  "connections.field.name": "Nombre",
  "connections.field.namePlaceholder": "Mi agente",
  "connections.field.address": "Dirección (URL endpoint)",
  "connections.field.addressPlaceholder": "https://agent.example.com/chat",
  "connections.field.key": "Clave (Bearer token)",
  "connections.field.keyPlaceholder": "secreto",
  "connections.field.contextSize": "Tamaño del contexto (mensajes)",
  "connections.field.callLimit": "Llamadas por día (0 — sin límite)",
  "connections.field.llmModel": "Modelo LLM",
  "connections.field.llmModelPlaceholder": "p. ej. gpt-4o-mini",
  "connections.add": "Añadir",
  "connections.added": "Agente añadido",
  "connections.missingFields": "Indica el nombre y la dirección del agente",
  "connections.list": "Agentes",
  "connections.empty": "Aún no hay agentes.",
  "connections.remove": "Eliminar",
  "connections.summary": "contexto: {contextSize} · llamadas/día: {callLimit} · modelo: {model}",
  "connections.keySaved": "clave guardada — introduce una nueva para reemplazarla",
  "connections.keyMissing": "sin clave",
  "connections.saveKey": "Guardar clave",
  "connections.keyUpdated": "Clave actualizada",
} as const satisfies LocaleMessages;
