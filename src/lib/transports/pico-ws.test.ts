import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  frame(payload: unknown): void {
    this.emit("message", { data: JSON.stringify(payload) });
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

const ctor = FakeWebSocket as unknown as PicoSocketCtor;

/** Открыть соединение и дать `message.send` уйти. */
async function connect(ev = {}) {
  const transport = makePicoTransport(ctor);
  const p = transport.send(req(), ev);
  const ws = FakeWebSocket.instances.at(-1)!;
  ws.emit("open");
  await vi.advanceTimersByTimeAsync(0);
  return { p, ws };
}

/** Сколько времени нужно, чтобы тишина после ответа закрыла ход. */
const QUIET = 1600;

describe("pico-ws transport", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("handshake: subprotocol token.*, session_id в URL, шлёт message.send", async () => {
    const { p, ws } = await connect();

    expect(ws.protocols).toEqual(["token.secret"]);
    expect(ws.url).toBe("wss://pico.test/pico/ws?session_id=ses1");

    expect(ws.sent).toHaveLength(1);
    const frame = JSON.parse(ws.sent[0]);
    expect(frame.type).toBe("message.send");
    expect(frame.payload.content).toBe("hi");

    ws.frame({ type: "message.create", payload: { content: "ответ", message_id: "m2" } });
    await vi.advanceTimersByTimeAsync(QUIET);
    await expect(p).resolves.toEqual({ reply: "ответ" });
  });

  it("заглушка «думаю…» не считается ответом и не завершает ход", async () => {
    const { p, ws } = await connect();
    let done = false;
    void p.then(
      () => (done = true),
      () => (done = true),
    );

    ws.frame({ type: "typing.start" });
    ws.frame({
      type: "message.create",
      payload: { content: "Думаю…", message_id: "ph1", placeholder: true },
    });
    // typing.stop приходит ДО финального ответа — это не конец хода.
    ws.frame({ type: "typing.stop" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(done).toBe(false);

    ws.frame({ type: "message.create", payload: { content: "готово", message_id: "m1" } });
    await vi.advanceTimersByTimeAsync(QUIET);
    await expect(p).resolves.toEqual({ reply: "готово" });
  });

  it("message.update продлевает ход и стримит прирост в onDelta", async () => {
    const onDelta = vi.fn();
    const { p, ws } = await connect({ onDelta });

    ws.frame({ type: "message.create", payload: { content: "При", message_id: "m1" } });
    await vi.advanceTimersByTimeAsync(1000);
    ws.frame({ type: "message.update", payload: { content: "Привет", message_id: "m1" } });
    await vi.advanceTimersByTimeAsync(1000);
    ws.frame({ type: "message.update", payload: { content: "Привет, мир", message_id: "m1" } });
    await vi.advanceTimersByTimeAsync(QUIET);

    await expect(p).resolves.toEqual({ reply: "Привет, мир" });
    expect(onDelta.mock.calls.map((c) => c[1])).toEqual(["При", "вет", ", мир"]);
  });

  it("шаг хода отдаётся один раз, обновления не дублируются", async () => {
    const onMessage = vi.fn();
    const onUpdate = vi.fn();
    const { p, ws } = await connect({ onMessage, onUpdate });

    ws.frame({
      type: "message.create",
      payload: { kind: "thought", content: "думаю", message_id: "t1" },
    });
    ws.frame({
      type: "message.update",
      payload: { kind: "thought", content: "думаю дальше", message_id: "t1" },
    });
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: "t1", kind: "thought", content: "думаю" }),
    );
    expect(onUpdate).toHaveBeenCalledWith("t1", "думаю дальше");

    ws.frame({ type: "message.create", payload: { content: "ответ", message_id: "m1" } });
    await vi.advanceTimersByTimeAsync(QUIET);
    await expect(p).resolves.toEqual({ reply: "ответ" });
  });

  it("вложения финального сообщения → attachments в ответе (только изображения)", async () => {
    const { p, ws } = await connect();

    ws.frame({
      type: "message.create",
      payload: {
        content: "вот фото",
        message_id: "m3",
        attachments: [
          { type: "image", url: "/pico/media/r1", content_type: "image/jpeg" },
          { type: "file", url: "/pico/media/r2", filename: "doc.pdf" },
        ],
      },
    });
    await vi.advanceTimersByTimeAsync(QUIET);

    await expect(p).resolves.toEqual({
      reply: "вот фото",
      attachments: [{ url: "/pico/media/r1", filename: undefined, contentType: "image/jpeg" }],
    });
  });

  it("error-кадр → pico_error с кодом, чужой request_id игнорируется", async () => {
    const { p, ws } = await connect();

    ws.frame({
      type: "error",
      payload: { code: "other", message: "не наш", request_id: "another" },
    });
    const assertion = expect(p).rejects.toMatchObject({ code: "pico_error", detail: "empty_content" });
    ws.frame({
      type: "error",
      payload: { code: "empty_content", message: "no content" },
    });
    // error-кадру даётся пауза: ход может продолжиться на резервной модели.
    await vi.advanceTimersByTimeAsync(3100);
    await assertion;
  });

  it("служебная плашка не завершает ход: настоящий ответ приходит следом", async () => {
    const onNotice = vi.fn();
    const { p, ws } = await connect({ onNotice });

    ws.frame({
      type: "message.create",
      payload: {
        content: "⏳ Модель не ответила вовремя. Повтори сообщение — я переключусь на резервную модель.",
        message_id: "n1",
      },
    });
    await vi.advanceTimersByTimeAsync(QUIET);
    expect(onNotice).toHaveBeenCalledTimes(1);

    // Ход жив: идут размышления, затем настоящий ответ.
    ws.frame({
      type: "message.create",
      payload: { kind: "thought", content: "думаю дальше", message_id: "t9" },
    });
    ws.frame({ type: "message.create", payload: { content: "ответ", message_id: "m10" } });
    await vi.advanceTimersByTimeAsync(QUIET);

    await expect(p).resolves.toEqual({ reply: "ответ" });
  });

  it("после плашки долгая пауза резервной модели не рвёт ход", async () => {
    const { p, ws } = await connect();

    ws.frame({
      type: "message.create",
      payload: { content: "⏳ Модель не ответила вовремя.", message_id: "n4" },
    });
    // Резервная модель думает 5 минут без единого кадра — это не обрыв.
    await vi.advanceTimersByTimeAsync(300_000);
    ws.frame({ type: "message.create", payload: { content: "ответ", message_id: "m40" } });
    await vi.advanceTimersByTimeAsync(QUIET);

    await expect(p).resolves.toEqual({ reply: "ответ" });
  });

  it("плашка без продолжения → реальная ошибка ws_timeout через 10 минут", async () => {
    const { p, ws } = await connect();

    ws.frame({
      type: "message.create",
      payload: { content: "⚠️ Не смог обработать сообщение.", message_id: "n2" },
    });
    const assertion = expect(p).rejects.toMatchObject({ code: "ws_timeout" });
    await vi.advanceTimersByTimeAsync(601_000);
    await assertion;
  });

  it("error-кадр посреди живого хода не обрывает генерацию", async () => {
    const { p, ws } = await connect();

    ws.frame({ type: "error", payload: { code: "noise", message: "empty_content" } });
    await vi.advanceTimersByTimeAsync(1000);
    ws.frame({
      type: "message.create",
      payload: { kind: "thought", content: "всё ещё думаю", message_id: "t1" },
    });
    await vi.advanceTimersByTimeAsync(3000);
    ws.frame({ type: "message.create", payload: { content: "ответ", message_id: "m2" } });
    await vi.advanceTimersByTimeAsync(QUIET);

    await expect(p).resolves.toEqual({ reply: "ответ" });
  });

  it("listen: ничего не отправляет и подбирает ответ идущего хода", async () => {
    const transport = makePicoTransport(ctor);
    const p = transport.listen!(req(), {});
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.emit("open");
    await vi.advanceTimersByTimeAsync(0);

    expect(ws.sent).toHaveLength(0);
    expect(ws.url).toBe("wss://pico.test/pico/ws?session_id=ses1");

    ws.frame({ type: "message.create", payload: { content: "поздний ответ", message_id: "m5" } });
    await vi.advanceTimersByTimeAsync(QUIET);
    await expect(p).resolves.toEqual({ reply: "поздний ответ" });
  });

  it("обрыв до ответа → ws_closed", async () => {
    const { p, ws } = await connect();
    const assertion = expect(p).rejects.toMatchObject({ code: "ws_closed" });
    ws.emit("close");
    await assertion;
  });

  it("закрытие до open — повторное подключение, а не мгновенная ошибка", async () => {
    const transport = makePicoTransport(ctor);
    const p = transport.send(req(), {});
    const first = FakeWebSocket.instances.at(-1)!;
    first.emit("close");
    await vi.advanceTimersByTimeAsync(1000);

    const second = FakeWebSocket.instances.at(-1)!;
    expect(second).not.toBe(first);
    second.emit("open");
    await vi.advanceTimersByTimeAsync(0);
    second.frame({ type: "message.create", payload: { content: "ok", message_id: "m1" } });
    await vi.advanceTimersByTimeAsync(QUIET);
    await expect(p).resolves.toEqual({ reply: "ok" });
  });

  it("abort → network/aborted", async () => {
    const ac = new AbortController();
    const transport = makePicoTransport(ctor);
    const p = transport.send(req({ signal: ac.signal }), {});
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.emit("open");
    await vi.advanceTimersByTimeAsync(0);

    const assertion = expect(p).rejects.toMatchObject({ code: "network", detail: "aborted" });
    ac.abort();
    await assertion;
  });

  it("молчание агента дольше 15 минут → ws_timeout, а не вечное ожидание", async () => {
    const { p } = await connect();
    const assertion = expect(p).rejects.toMatchObject({ code: "ws_timeout" });
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    await assertion;
  });

  it("долгий ход с шагами не обрывается по 120 секундам", async () => {
    const { p, ws } = await connect();
    for (let i = 0; i < 6; i++) {
      ws.frame({
        type: "message.create",
        payload: { kind: "tool_calls", content: `шаг ${i}`, message_id: `tc${i}` },
      });
      await vi.advanceTimersByTimeAsync(30_000);
    }
    ws.frame({ type: "message.create", payload: { content: "итог", message_id: "m9" } });
    await vi.advanceTimersByTimeAsync(QUIET);
    await expect(p).resolves.toEqual({ reply: "итог" });
  });
});
