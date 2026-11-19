/**
 * Ошибка клиента агента. UI переводит код/статус в текст через i18n,
 * поэтому сообщение не зависит от языка.
 */

export type AgentClientErrorCode =
  | "no_address"
  | "network"
  | "not_json"
  | "no_reply"
  | "ws_connect"
  | "ws_closed"
  | "ws_timeout"
  | "pico_error"
  | "openai_error"
  | "openai_empty";

export class AgentClientError extends Error {
  readonly status?: number;
  readonly code?: AgentClientErrorCode;
  /** Сырой текст сетевой ошибки — подставляется в переведённый шаблон. */
  readonly detail?: string;

  constructor(
    message: string,
    status?: number,
    code?: AgentClientErrorCode,
    detail?: string,
  ) {
    super(message);
    this.name = "AgentClientError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}
