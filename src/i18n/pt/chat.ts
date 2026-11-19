import type { LocaleMessages } from "../types";

export const chatMessages = {
  "chat.agent": "Agente",
  "chat.selectAgent": "— selecione —",
  "chat.newDialog": "Novo diálogo",
  "chat.dialogs": "Diálogos",
  "chat.selectOrCreate": "Selecione ou crie um diálogo",
  "chat.messagesEmpty": "Ainda não há mensagens.",
  "chat.composerPlaceholder": "Mensagem… (Enter para enviar)",
  "chat.send": "Enviar",
  "chat.usage": "{used} / {limit} chamadas hoje",
  "chat.remaining": "Chamadas restantes hoje: {remaining}",
  "chat.error.chooseAgent": "Selecione um agente",
  "chat.error.noSession": "Primeiro crie ou abra uma sessão",
  "chat.error.agentNotFound": "O agente da sessão não foi encontrado",
  "chat.error.noKey": "Este agente não tem chave. Insira-a em «Conexões».",
  "chat.error.limitReached": "O limite diário de {limit} chamadas foi atingido. O contador reinicia amanhã (UTC).",
  "chat.newDialogTitle": "Novo diálogo",
  "chat.role.user": "usuário",
  "chat.role.assistant": "assistente",
  "chat.role.system": "sistema",
} as const satisfies LocaleMessages;
