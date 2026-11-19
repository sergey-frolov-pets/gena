import type { LocaleMessages } from "../types";

export const errorsMessages = {
  "errors.status.400": "智能体拒绝了请求（400）。请检查消息格式和智能体设置。",
  "errors.status.401": "智能体密钥错误（401/403）。请在「连接」中检查密钥。",
  "errors.status.404": "该地址未找到智能体（404）。请检查 URL endpoint。",
  "errors.status.408": "智能体未及时响应（408）。请重试。",
  "errors.status.413": "请求过大（413）。请在智能体设置中减小上下文大小。",
  "errors.status.429": "智能体侧请求受限（429）。请稍后再试。",
  "errors.status.5xx": "智能体暂时不可用（{status}）。请稍后再试。",
  "errors.status.other": "智能体返回错误 {status}。",
  "errors.network.cors": "浏览器阻止了请求（CORS）。智能体需允许本站来源。",
  "errors.network.unreachable": "无法连接智能体：无网络或地址无响应（可能是 CORS）。",
  "errors.network.aborted": "请求被中断或超时。请重试。",
  "errors.network.other": "无法连接智能体：{raw}",
  "errors.cipher.missingSeed": "浏览器不保存数据（隐私模式）— 无法安全保存密钥。",
  "errors.cipher.decryptFailed": "无法解密智能体密钥。请在「连接」中重新输入密钥。",
  "errors.client.noAddress": "智能体未设置地址。请在「连接」中填写。",
  "errors.client.notJson": "智能体返回的不是 JSON。请确认该地址是智能体的 endpoint。",
  "errors.client.noReply": "智能体响应中缺少 reply 字段。请检查智能体契约。",
} as const satisfies LocaleMessages;
