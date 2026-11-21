/**
 * Низкоуровневая обёртка над браузерным WebSocket для канала Pico.
 *
 * Браузер не умеет ставить заголовки на WebSocket, поэтому авторизация
 * идёт subprotocol'ом `token.<token>` (сервер возвращает его же в ответ —
 * иначе браузер закроет соединение). `session_id` передаётся query-параметром.
 */

export const WS_CONNECTING = 0;
export const WS_OPEN = 1;
export const WS_CLOSING = 2;
export const WS_CLOSED = 3;

/** Минимальный контракт WebSocket, который реализует браузер и FakeWebSocket в тестах. */
export interface PicoSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (ev: any) => void): void;
  removeEventListener(type: string, listener: (ev: any) => void): void;
}

export type PicoSocketCtor = new (
  url: string,
  protocols?: string | string[],
) => PicoSocketLike;

/** Кадр Pico (один тип `PicoMessage` на все направления). */
export interface PicoFrame {
  type?: string;
  id?: string;
  session_id?: string;
  timestamp?: number;
  payload?: {
    content?: string;
    message_id?: string;
    kind?: string;
    model_name?: string;
    usage?: unknown;
    code?: string;
    message?: string;
    [key: string]: unknown;
  };
}

export interface PicoConnectionHandlers {
  onMessage: (frame: PicoFrame) => void;
  onClose: (event: unknown) => void;
}

export class PicoConnection {
  private socket: PicoSocketLike | null = null;
  private handlers: PicoConnectionHandlers | null = null;

  constructor(private readonly ctor: PicoSocketCtor) {}

  connect(url: string, token: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const socket = new this.ctor(url, [`token.${token}`]);
      this.socket = socket;

      const onOpen = () => {
        if (settled) return;
        settled = true;
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
        resolve();
      };
      const onError = (ev: unknown) => {
        if (settled) return;
        settled = true;
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
        const msg = (ev as { message?: string } | null)?.message ?? "WebSocket error";
        reject(new Error(msg));
      };

      // Браузер может закрыть соединение без события error — не ждём вечно.
      const onEarlyClose = () => {
        if (settled) return;
        settled = true;
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
        reject(new Error("WebSocket closed before open"));
      };

      socket.addEventListener("open", onOpen);
      socket.addEventListener("error", onError);
      socket.addEventListener("close", onEarlyClose);
      socket.addEventListener("message", (ev: unknown) => {
        // Кадр от сокета, который уже заменён новым (переподключение), — не про
        // текущую связь. Без этой проверки после восстановления прилетал дубль.
        if (this.socket !== socket) return;
        const raw = (ev as { data?: unknown } | null)?.data;
        let frame: PicoFrame;
        if (typeof raw === "string") {
          try {
            frame = JSON.parse(raw) as PicoFrame;
          } catch {
            return;
          }
        } else if (raw && typeof raw === "object") {
          frame = raw as PicoFrame;
        } else {
          return;
        }
        this.handlers?.onMessage(frame);
      });
      socket.addEventListener("close", (ev: unknown) => {
        // Поздний `close` отброшенного сокета (неудачная попытка переподключения
        // закрывается уже после того, как открылся новый) не должен выглядеть
        // обрывом текущей связи — иначе восстановление запускается по кругу.
        if (this.socket !== socket) return;
        this.handlers?.onClose(ev);
      });
    });
  }

  setHandlers(handlers: PicoConnectionHandlers): void {
    this.handlers = handlers;
  }

  send(obj: unknown): void {
    this.socket?.send(JSON.stringify(obj));
  }

  close(): void {
    try {
      this.socket?.close();
    } catch {
      // noop
    }
    this.socket = null;
  }

  get readyState(): number {
    return this.socket?.readyState ?? WS_CLOSED;
  }
}
