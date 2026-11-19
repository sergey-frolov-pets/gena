import type { LocaleMessages } from "../types";

export const sessionsMessages = {
  "sessions.title": "セッションとデータ",
  "sessions.selectAll": "すべて選択",
  "sessions.deselectAll": "選択を解除",
  "sessions.selected": "選択中: {count} / {total}",
  "sessions.empty": "セッションがありません。",
  "sessions.item": "· {agent} · {count} 件 · {date}",
  "sessions.backup.title": "履歴のバックアップ",
  "sessions.backup.intro":
    "エクスポートは平文 JSON です。ファイルにはエージェントのキーやパスワードは含まれません（セッション、メッセージ、エージェント設定のみ）。インポート後にキーを再入力してください。",
  "sessions.backup.onlySelected": "選択したセッションのみエクスポート",
  "sessions.backup.export": "ファイルにエクスポート",
  "sessions.backup.import": "ファイルからインポート",
  "sessions.backup.exported":
    "エクスポートしました: {sessions} セッション、{messages} メッセージ。キーとパスワードは含まれません。",
  "sessions.backup.imported": "インポート（マージ）: {parts}。既存エージェントのキーは保持されます。新しいエージェントにはキーを入力してください。",
  "sessions.backup.importedAgents": "エージェント: +{added} / 更新 {updated}",
  "sessions.backup.importedSessions": "セッション: +{added}",
  "sessions.backup.importedMessages": "メッセージ: +{added}",
  "sessions.backup.importedSkipped": "スキップした競合: {count}",
  "sessions.cleanup.title": "IndexedDB のクリーンアップ",
  "sessions.cleanup.exceptSelected": "選択以外をすべて削除（{count}）",
  "sessions.cleanup.removed": "削除しました: {sessions} セッション、{messages} メッセージ。{kept} 件を保持。",
  "sessions.cleanup.confirmAll": "すべてのセッション削除に同意します",
  "sessions.cleanup.deleteAll": "すべてのセッションを削除",
  "sessions.cleanup.needConfirm": "すべて削除するには確認にチェックを入れてください",
  "sessions.cleanup.removedAll": "すべて削除しました: {sessions} セッション、{messages} メッセージ。",
  "sessions.cleanup.agentsKept": "クリーンアップ時もエージェントは保持されます。",
} as const satisfies LocaleMessages;
