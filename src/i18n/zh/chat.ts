import type { LocaleMessages } from "../types";

export const chatMessages = {
  "chat.agent": "智能体",
  "chat.selectAgent": "— 请选择 —",
  "chat.newDialog": "新对话",
  "chat.dialogs": "对话",
  "chat.selectOrCreate": "请选择或新建对话",
  "chat.messagesEmpty": "还没有消息。",
  "chat.composerPlaceholder": "消息…（Enter 发送）",
  "chat.send": "发送",
  "chat.usage": "今日已调用 {used} / {limit} 次",
  "chat.remaining": "今日剩余调用次数：{remaining}",
  "chat.error.chooseAgent": "请选择智能体",
  "chat.error.noSession": "请先创建或打开会话",
  "chat.error.agentNotFound": "找不到该会话的智能体",
  "chat.error.noKey": "该智能体未设置密钥。请在「连接」中填写。",
  "chat.error.limitReached": "每日 {limit} 次调用上限已用完。计数器将于明天（UTC）重置。",
  "chat.newDialogTitle": "新对话",
  "chat.role.user": "用户",
  "chat.role.assistant": "助手",
  "chat.role.system": "系统",
} as const satisfies LocaleMessages;
