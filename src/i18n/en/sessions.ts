import type { LocaleMessages } from "../types";

export const sessionsMessages = {
  "sessions.title": "Sessions & data",
  "sessions.selectAll": "Select all",
  "sessions.deselectAll": "Deselect all",
  "sessions.selected": "Selected: {count} of {total}",
  "sessions.empty": "No sessions.",
  "sessions.item": "· {agent} · {count} msg · {date}",
  "sessions.backup.title": "History backup",
  "sessions.backup.intro":
    "Export is plain JSON. The file does not include agent keys or passwords: only sessions, messages and agent settings (address, model, limits). After import the agent key must be entered again.",
  "sessions.backup.onlySelected": "Export only selected sessions",
  "sessions.backup.export": "Export to file",
  "sessions.backup.import": "Import from file",
  "sessions.backup.exported":
    "Exported: {sessions} sessions, {messages} messages. Agent keys and passwords are not included.",
  "sessions.backup.imported":
    "Import (merge): {parts}. Keys of existing agents are kept; enter keys for new agents.",
  "sessions.backup.importedAgents": "agents: +{added} / updated {updated}",
  "sessions.backup.importedSessions": "sessions: +{added}",
  "sessions.backup.importedMessages": "messages: +{added}",
  "sessions.backup.importedSkipped": "conflicts skipped: {count}",
  "sessions.cleanup.title": "IndexedDB cleanup",
  "sessions.cleanup.exceptSelected": "Delete everything except selected ({count})",
  "sessions.cleanup.removed": "Deleted: {sessions} sessions, {messages} messages. Kept {kept}.",
  "sessions.cleanup.confirmAll": "I confirm deleting all sessions",
  "sessions.cleanup.deleteAll": "Delete all sessions",
  "sessions.cleanup.needConfirm": "Tick the confirmation box to delete everything",
  "sessions.cleanup.removedAll": "Deleted everything: {sessions} sessions, {messages} messages.",
  "sessions.cleanup.agentsKept": "Agents are kept during cleanup.",
  "sessions.confirm": "Delete",
  "sessions.cancel": "Cancel",
  "sessions.cleanup.confirmAllText": "All sessions and messages will be deleted permanently. Agents are kept.",
  "sessions.cleanup.confirmExceptText": "Only the {keep} selected sessions will remain. All other sessions and messages will be deleted permanently.",
} as const satisfies LocaleMessages;
