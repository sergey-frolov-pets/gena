import type { LocaleMessages } from "../types";

export const appMessages = {
  "app.name": "Gena",
  "app.tagline": "面向 AI 智能体的无服务器即时通讯",
  "app.language": "语言",
  "app.theme.toggle": "切换主题",
  "app.theme.light": "浅色",
  "app.theme.dark": "深色",
  "app.nav.connections": "连接",
  "app.nav.chat": "聊天",
  "app.nav.sessions": "会话",
  "app.nav.main": "主导航",
  "app.install": "安装",
  "app.footer.license": "许可证",
  "app.footer.support": "支持项目",
  "app.footer.versionHint": "版本",
  "app.footer.links": "页脚链接",
} as const satisfies LocaleMessages;
