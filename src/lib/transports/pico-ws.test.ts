import { beforeEach, describe, expect, it, vi } from "vitest";
import { makePicoTransport } from "./pico-ws";
import type { PicoSocketCtor } from "./pico-connection";
import type { Agent, Message } from "@/storage/types";

/**
 * Управляемый WebSocket для тестов: события подаются вручную через emit().
 */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  protocols: string[];
  readyState = 0;
  sent: string[] = [];
  private listeners: Record<string, Array<(ev: unknown) => void>> = {};

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = Array.isArray(protocols) ? protocols : protocols ? [protocols] : [];
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (ev: unknown) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }
  removeEventListener(type: string, listener: (ev: unknown) => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== listener);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
  }
  emit(type: string, ev: unknown = {}): void {
    if (type === "open") this.readyState = 1;
    for (const fn of this.listeners[type] ?? []) fn(ev);
  }
}

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "a1",
    name: "A",
    address: "wss://pico.test",
    sealedKey: "enc:v1:x.y",
    settings: { contextSize: 20, callLimit: 0, llmModel: "" },
    protocol: "pico_ws",
    config: {},
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function req(overrides: Partial<Parameters<ReturnType<typeof makePicoTransport>["send"]>[0]> = {}) {
  return {
    agent: agent(),
    apiKey: "secret",
    sessionId: "ses1",
    message: "hi",
    history: [] as Message[],
    signal: new AbortController().signal,
    fetchImpl: undefined as unknown as typeof fetch,
    ...overrides,
  };
}

async function tick(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

const ctor = FakeWebSocket as unknown as PicoSocketCtor;

describe("pico-ws transport", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
  });

  it("handshake: subprotocol token.*, session_id в URL, шлёт message.send", async () => {
    const transport = makePicoTransport(ctor);
    const p = transport.send(req(), {});

    const ws = FakeWebSocket.instances.at(-1)!;
    expect(ws.protocols).toEqual(["token.secret"]);
    expect(ws.url).toContain("session_id=ses1");
    expect(ws.url).toBe("wss://pico.test/pico/ws?session_id=ses1");

    ws.emit("open");
    await tick();
    expect(ws.sent).toHaveLength(1);
    const frame = JSON.parse(ws.sent[0]);
    expect(frame.type).toBe("message.send");
    expect(frame.payload.content).toBe("hi");

    ws.emit("message", {
      data: JSON.stringify({ type: "message.create", payload: { content: "ответ" } }),
    });
    ws.emit("message", { data: JSON.stringify({ type: "typing.stop" }) });
    await expect(p).resolves.toEqual({ reply: "ответ" });
  });

  it("thought → onMessage, final → resolve, typing.stop завершает ход", async () => {
    const onMessage = vi.fn();
    const onTyping = vi.fn();
    const transport = makePicoTransport(ctor);
    const p = transport.send(req(), { onMessage, onTyping });

    const ws = FakeWebSocket.instances.at(-1)!;
    ws.emit("open");
    await tick();

    ws.emit("message", {
      data: JSON.stringify({ type: "typing.start" }),
    });
    ws.emit("message", {
      data: JSON.stringify({
        type: "message.create",
        payload: { kind: "thought", content: "думаю", message_id: "m1" },
      }),
    });
    expect(onTyping).toHaveBeenCalledWith(true);
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "thought", content: "думаю" }),
    );

    ws.emit("message", {
      data: JSON.stringify({ type: "message.create", payload: { content: "ответ", message_id: "m2" } }),
    });
    ws.emit("message", { data: JSON.stringify({ type: "typing.stop" }) });
    await expect(p).resolves.toEqual({ reply: "ответ" });
    expect(onTyping).toHaveBeenCalledWith(false);
  });

  it("вложения финального сообщения → attachments в ответе (только изображения)", async () => {
    const transport = makePicoTransport(ctor);
    const p = transport.send(req(), {});
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.emit("open");
    await tick();

    ws.emit("message", {
      data: JSON.stringify({
        type: "message.create",
        payload: {
          content: "вот фото",
          message_id: "m3",
          attachments: [
            { type: "image", url: "/pico/media/r1", content_type: "image/jpeg" },
            { type: "file", url: "/pico/media/r2", filename: "doc.pdf" },
          ],
        },
      }),
    });
    ws.emit("message", { data: JSON.stringify({ type: "typing.stop" }) });

    await expect(p).resolves.toEqual({
      reply: "вот фото",
      attachments: [{ url: "/pico/media/r1", filename: undefined, contentType: "image/jpeg" }],
    });
  });

  it("error-кадр → pico_error с кодом", async () => {
    const transport = makePicoTransport(ctor);
    const p = transport.send(req(), {});
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.emit("open");
    await tick();

    ws.emit("message", {
      data: JSON.stringify({
        type: "error",
        payload: { code: "empty_content", message: "no content" },
      }),
    });
    await expect(p).rejects.toMatchObject({ code: "pico_error", detail: "empty_content" });
  });

  it("обрыв до ответа → ws_closed", async () => {
    const transport = makePicoTransport(ctor);
    const p = transport.send(req(), {});
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.emit("open");
    await tick();

    ws.emit("close");
    await expect(p).rejects.toMatchObject({ code: "ws_closed" });
  });

  it("abort → network/aborted", async () => {
    const ac = new AbortController();
    const transport = makePicoTransport(ctor);
    const p = transport.send(req({ signal: ac.signal }), {});
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.emit("open");
    await tick();

    ac.abort();
    await expect(p).rejects.toMatchObject({ code: "network", detail: "aborted" });
  });
});
