import type { LocaleMessages } from "../types";

export const appMessages = {
  "app.name": "Gena",
  "app.tagline": "AI エージェント向けのサーバーレスメッセンジャー",
  "app.language": "言語",
  "app.theme.toggle": "テーマを切り替え",
  "app.theme.light": "ライト",
  "app.theme.dark": "ダーク",
  "app.nav.connections": "接続",
  "app.nav.chat": "チャット",
  "app.nav.sessions": "セッション",
  "app.nav.main": "メインナビゲーション",
} as const satisfies LocaleMessages;
