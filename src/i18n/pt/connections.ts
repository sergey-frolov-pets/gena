import type { LocaleMessages } from "../types";

export const connectionsMessages = {
  "connections.title": "Conexões com agentes",
  "connections.intro":
    "A chave do agente é guardada criptografada no navegador (AES-GCM, a chave fica neste dispositivo). As chaves nunca entram nos backups.",
  "connections.newAgent": "Novo agente",
  "connections.field.name": "Nome",
  "connections.field.namePlaceholder": "Meu agente",
  "connections.field.address": "Endereço (URL endpoint)",
  "connections.field.addressPlaceholder": "https://agent.example.com/chat",
  "connections.field.key": "Chave (Bearer token)",
  "connections.field.keyPlaceholder": "segredo",
  "connections.field.contextSize": "Tamanho do contexto (mensagens)",
  "connections.field.callLimit": "Chamadas por dia (0 — sem limite)",
  "connections.field.llmModel": "Modelo LLM",
  "connections.field.llmModelPlaceholder": "ex.: gpt-4o-mini",
  "connections.add": "Adicionar",
  "connections.added": "Agente adicionado",
  "connections.missingFields": "Informe o nome e o endereço do agente",
  "connections.list": "Agentes",
  "connections.empty": "Ainda não há agentes.",
  "connections.remove": "Excluir",
  "connections.summary": "contexto: {contextSize} · chamadas/dia: {callLimit} · modelo: {model}",
  "connections.keySaved": "chave salva — insira uma nova para substituí-la",
  "connections.keyMissing": "sem chave",
  "connections.saveKey": "Salvar chave",
  "connections.keyUpdated": "Chave atualizada",
} as const satisfies LocaleMessages;
