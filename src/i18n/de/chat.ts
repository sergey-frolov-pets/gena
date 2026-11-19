import type { LocaleMessages } from "../types";

export const chatMessages = {
  "chat.agent": "Agent",
  "chat.selectAgent": "— auswählen —",
  "chat.newDialog": "Neuer Dialog",
  "chat.dialogs": "Dialoge",
  "chat.selectOrCreate": "Dialog auswählen oder erstellen",
  "chat.messagesEmpty": "Noch keine Nachrichten.",
  "chat.composerPlaceholder": "Nachricht… (Enter zum Senden)",
  "chat.send": "Senden",
  "chat.usage": "{used} / {limit} Aufrufe heute",
  "chat.remaining": "Verbleibende Aufrufe heute: {remaining}",
  "chat.error.chooseAgent": "Agent auswählen",
  "chat.error.noSession": "Zuerst eine Sitzung erstellen oder öffnen",
  "chat.error.agentNotFound": "Der Agent der Sitzung wurde nicht gefunden",
  "chat.error.noKey": "Dieser Agent hat keinen Schlüssel. Unter „Verbindungen“ eingeben.",
  "chat.error.limitReached": "Das Tageslimit von {limit} Aufrufen ist erschöpft. Der Zähler wird morgen (UTC) zurückgesetzt.",
  "chat.newDialogTitle": "Neuer Dialog",
  "chat.role.user": "Benutzer",
  "chat.role.assistant": "Assistent",
  "chat.role.system": "System",
} as const satisfies LocaleMessages;
