import type { LocaleMessages } from "../types";

export const connectionsMessages = {
  "connections.title": "エージェント接続",
  "connections.intro":
    "エージェントのキーはブラウザ内に暗号化して保存されます（AES-GCM、キーはこの端末に留まります）。キーがバックアップに含まれることはありません。",
  "connections.newAgent": "新しいエージェント",
  "connections.field.name": "名前",
  "connections.field.namePlaceholder": "マイエージェント",
  "connections.field.address": "アドレス（URL endpoint）",
  "connections.field.addressPlaceholder": "https://agent.example.com/chat",
  "connections.field.key": "キー（Bearer token）",
  "connections.field.keyPlaceholder": "シークレット",
  "connections.field.contextSize": "コンテキストサイズ（メッセージ数）",
  "connections.field.callLimit": "1日の呼び出し上限（0 — 無制限）",
  "connections.field.llmModel": "LLM モデル",
  "connections.field.llmModelPlaceholder": "例: gpt-4o-mini",
  "connections.add": "追加",
  "connections.added": "エージェントを追加しました",
  "connections.missingFields": "エージェントの名前とアドレスを入力してください",
  "connections.list": "エージェント一覧",
  "connections.empty": "エージェントはまだありません。",
  "connections.remove": "削除",
  "connections.summary": "コンテキスト: {contextSize} · 1日の上限: {callLimit} · モデル: {model}",
  "connections.keySaved": "キーは保存済み — 置き換えるには新しいキーを入力",
  "connections.keyMissing": "キー未設定",
  "connections.saveKey": "キーを保存",
  "connections.keyUpdated": "キーを更新しました",
} as const satisfies LocaleMessages;
