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
  /** Сервер Pico отвечает на `ping` кадром `pong` — фейк делает то же. */
  autoPong = true;
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
    if (!this.autoPong) return;
    let frame: { type?: string; id?: string } | null = null;
    try {
      frame = JSON.parse(data) as { type?: string; id?: string };
    } catch {
      return;
    }
    if (frame?.type === "ping") {
      // Ответ приходит следующим тиком — как по сети.
      setTimeout(() => this.frame({ type: "pong", id: frame?.id }), 0);
    }
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
    await expect(p).resolves.toMatchObject({ reply: "ответ" });
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
    await expect(p).resolves.toMatchObject({ reply: "готово" });
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

    await expect(p).resolves.toMatchObject({ reply: "Привет, мир" });
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
    await expect(p).resolves.toMatchObject({ reply: "ответ" });
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
      serverId: "m3",
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

    await expect(p).resolves.toMatchObject({ reply: "ответ" });
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

    await expect(p).resolves.toMatchObject({ reply: "ответ" });
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

    await expect(p).resolves.toMatchObject({ reply: "ответ" });
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
    await expect(p).resolves.toMatchObject({ reply: "поздний ответ" });
  });

  it("обрыв до ответа: молча переподключается и добирает кадры хода", async () => {
    const { p, ws } = await connect();
    ws.emit("close");
    await vi.advanceTimersByTimeAsync(600);

    const second = FakeWebSocket.instances.at(-1)!;
    expect(second).not.toBe(ws);
    second.emit("open");
    await vi.advanceTimersByTimeAsync(0);

    const ask = second.sent.map((raw) => JSON.parse(raw)).find((f) => f.type === "turn.resume");
    expect(ask).toBeTruthy();
    second.frame({ type: "message.create", payload: { content: "догнал", message_id: "m7" } });
    await vi.advanceTimersByTimeAsync(QUIET);

    await expect(p).resolves.toMatchObject({ reply: "догнал" });
  });

  it("обрыв и связи нет → ws_closed только после попыток восстановления", async () => {
    let offline = false;
    class Override extends FakeWebSocket {
      constructor(url: string, protocols?: string | string[]) {
        super(url, protocols);
        if (offline) setTimeout(() => this.emit("error", { message: "offline" }), 0);
      }
    }
    const transport = makePicoTransport(Override as unknown as PicoSocketCtor);
    const p = transport.send(req(), {});
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.emit("open");
    await vi.advanceTimersByTimeAsync(0);

    const assertion = expect(p).rejects.toMatchObject({ code: "ws_closed" });
    offline = true;
    ws.emit("close");
    // Шесть попыток с паузами 0.5…15 с — обрывается только после них.
    await vi.advanceTimersByTimeAsync(200_000);
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
    await expect(p).resolves.toMatchObject({ reply: "ok" });
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

  it("прикладной ping держит ход: pong приходит, ход не рвётся", async () => {
    const { p, ws } = await connect();
    await vi.advanceTimersByTimeAsync(200_000);
    const pings = ws.sent.filter((raw) => JSON.parse(raw).type === "ping");
    expect(pings.length).toBeGreaterThanOrEqual(7);

    ws.frame({ type: "message.create", payload: { content: "после паузы", message_id: "m1" } });
    await vi.advanceTimersByTimeAsync(QUIET);
    await expect(p).resolves.toMatchObject({ reply: "после паузы" });
  });

  it("нет pong → мёртвое соединение ловится за ~минуту, а не за 15", async () => {
    const transport = makePicoTransport(ctor);
    const p = transport.send(req(), {});
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.autoPong = false;
    ws.emit("open");
    await vi.advanceTimersByTimeAsync(0);

    const assertion = expect(p).rejects.toMatchObject({ code: "ws_timeout", detail: "no_pong" });
    await vi.advanceTimersByTimeAsync(80_000);
    await assertion;
  });

  it("message.delete убирает ответ и не даёт ему стать итогом хода", async () => {
    const onDelete = vi.fn();
    const { p, ws } = await connect({ onDelete });
    ws.frame({ type: "message.create", payload: { content: "черновой", message_id: "m1" } });
    ws.frame({ type: "message.delete", payload: { message_id: "m1" } });
    expect(onDelete).toHaveBeenCalledWith("m1");

    let done = false;
    void p.then(
      () => (done = true),
      () => (done = true),
    );
    await vi.advanceTimersByTimeAsync(QUIET + 100);
    expect(done).toBe(false);

    ws.frame({ type: "message.create", payload: { content: "итог", message_id: "m2" } });
    await vi.advanceTimersByTimeAsync(QUIET);
    await expect(p).resolves.toMatchObject({ reply: "итог", serverId: "m2" });
  });

  it("финальный ответ отдаёт serverId — по нему клиент удаляет сообщение", async () => {
    const { p, ws } = await connect();
    ws.frame({ type: "message.create", payload: { content: "ответ", message_id: "m7" } });
    await vi.advanceTimersByTimeAsync(QUIET);
    await expect(p).resolves.toMatchObject({ reply: "ответ", serverId: "m7" });
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
    await expect(p).resolves.toMatchObject({ reply: "итог" });
  });
});

describe("pico-ws: cancel и turn.resume", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("Стоп шлёт cancel в открытый сокет и возвращает accepted", async () => {
    const { p, ws } = await connect();
    ws.frame({ type: "typing.start" });

    const transport = makePicoTransport(ctor);
    const promise = transport.cancel!({ agent: agent(), apiKey: "secret", sessionId: "ses1" });
    await vi.advanceTimersByTimeAsync(0);

    const frame = ws.sent.map((raw) => JSON.parse(raw)).find((item) => item.type === "cancel");
    expect(frame).toBeTruthy();
    expect(frame.payload).toEqual({});

    ws.frame({
      type: "cancel",
      id: frame.id,
      payload: { request_id: frame.id, accepted: true, reason: "cancel_requested" },
    });
    await expect(promise).resolves.toEqual({ accepted: true, reason: "cancel_requested" });

    // Сервер прекратил ход — кадров больше не будет, соединение закрывается.
    ws.frame({ type: "typing.stop" });
    const assertion = expect(p).rejects.toMatchObject({ code: "ws_closed" });
    ws.emit("close");
    await vi.advanceTimersByTimeAsync(200_000);
    await assertion;
  });

  it("нет активного соединения — cancel честно говорит no_active_turn", async () => {
    const transport = makePicoTransport(ctor);
    await expect(
      transport.cancel!({ agent: agent(), apiKey: "secret", sessionId: "ses1" }),
    ).resolves.toEqual({ accepted: false, reason: "no_active_turn" });
  });

  it("без подтверждения cancel отвечает timeout, а не висит", async () => {
    const { p, ws } = await connect();
    const guard = p.catch(() => undefined);
    const transport = makePicoTransport(ctor);
    const promise = transport.cancel!({ agent: agent(), apiKey: "secret", sessionId: "ses1" });
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(promise).resolves.toEqual({ accepted: false, reason: "timeout" });
    ws.emit("close");
    await vi.advanceTimersByTimeAsync(200_000);
    await guard;
  });

  it("listen с since просит turn.resume и применяет пропущенные кадры", async () => {
    const transport = makePicoTransport(ctor);
    const states: Array<{ active: boolean; frames: number }> = [];
    const p = transport.listen!(req({ resumeSince: 1_700_000_000_000 }), {
      onTurnState: (state) => states.push(state),
    });
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.emit("open");
    await vi.advanceTimersByTimeAsync(0);

    expect(ws.sent).toHaveLength(1);
    const ask = JSON.parse(ws.sent[0]);
    expect(ask.type).toBe("turn.resume");
    expect(ask.payload).toMatchObject({ since: 1_700_000_000_000, limit: 200 });

    ws.frame({
      type: "turn.resume",
      id: ask.id,
      payload: {
        since: 1_700_000_000_000,
        active: false,
        returned: 2,
        frames: [
          {
            type: "message.create",
            payload: { kind: "thought", content: "думаю", message_id: "th1" },
          },
          { type: "message.create", payload: { content: "ответ из буфера", message_id: "m11" } },
        ],
      },
    });
    await vi.advanceTimersByTimeAsync(QUIET);
    await expect(p).resolves.toMatchObject({ reply: "ответ из буфера", serverId: "m11" });
    expect(states).toEqual([{ active: false, frames: 2 }]);
  });

  it("turn.resume: ход закончился без ответа → no_active_turn (реплику повторяем)", async () => {
    const transport = makePicoTransport(ctor);
    const p = transport.listen!(req({ resumeSince: 1_700_000_000_000 }), {});
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.emit("open");
    await vi.advanceTimersByTimeAsync(0);

    const ask = JSON.parse(ws.sent[0]);
    const assertion = expect(p).rejects.toMatchObject({ code: "no_active_turn" });
    ws.frame({
      type: "turn.resume",
      id: ask.id,
      payload: { since: 1_700_000_000_000, active: false, returned: 0, frames: [] },
    });
    await assertion;
  });

  it("turn.resume: active=true — продолжаем слушать, а не сдаёмся", async () => {
    const transport = makePicoTransport(ctor);
    const states: Array<{ active: boolean; frames: number }> = [];
    const p = transport.listen!(req({ resumeSince: 1_700_000_000_000 }), {
      onTurnState: (state) => states.push(state),
    });
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.emit("open");
    await vi.advanceTimersByTimeAsync(0);

    const ask = JSON.parse(ws.sent[0]);
    ws.frame({
      type: "turn.resume",
      id: ask.id,
      payload: { since: 1_700_000_000_000, active: true, returned: 0, frames: [] },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(states).toEqual([{ active: true, frames: 0 }]);

    ws.frame({ type: "message.create", payload: { content: "живой ответ", message_id: "m12" } });
    await vi.advanceTimersByTimeAsync(QUIET);
    await expect(p).resolves.toMatchObject({ reply: "живой ответ" });
  });
});

describe("pico-ws: восстановление связи после обрыва", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("поздний close отброшенного сокета не запускает второе восстановление", async () => {
    const { p, ws } = await connect();
    // Первый обрыв — переподключаемся на новый сокет.
    ws.emit("close");
    await vi.advanceTimersByTimeAsync(600);
    const second = FakeWebSocket.instances.at(-1)!;
    second.emit("open");
    await vi.advanceTimersByTimeAsync(0);

    // Старый сокет «дозакрывается» уже после восстановления: это не новый обрыв.
    ws.emit("close");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(FakeWebSocket.instances.at(-1)).toBe(second);

    second.frame({ type: "message.create", payload: { content: "догнал", message_id: "m7" } });
    await vi.advanceTimersByTimeAsync(QUIET);
    await expect(p).resolves.toMatchObject({ reply: "догнал" });
  });

  it("turn.resume без хода переспрашивает, а потом просит отправить реплику заново", async () => {
    const transport = makePicoTransport(ctor);
    const states: Array<{ active: boolean; frames: number }> = [];
    const p = transport.send(req(), { onTurnState: (state) => states.push(state) });
    const first = FakeWebSocket.instances.at(-1)!;
    first.emit("open");
    await vi.advanceTimersByTimeAsync(0);

    // Сокет умер сразу после отправки — сервер ход ещё не начал.
    first.emit("close");
    await vi.advanceTimersByTimeAsync(600);
    const second = FakeWebSocket.instances.at(-1)!;
    second.emit("open");
    await vi.advanceTimersByTimeAsync(0);

    const assertion = expect(p).rejects.toMatchObject({ code: "turn_lost" });
    // Три пустых ответа: два переспроса, только потом «реплика потеряна».
    for (let i = 0; i < 3; i++) {
      const asks = second.sent
        .map((raw) => JSON.parse(raw))
        .filter((frame) => frame.type === "turn.resume");
      second.frame({
        type: "turn.resume",
        id: asks.at(-1)?.id,
        payload: { active: false, returned: 0, frames: [] },
      });
      await vi.advanceTimersByTimeAsync(i < 2 ? 6_500 : 0);
    }
    await assertion;
    expect(states.length).toBeGreaterThanOrEqual(3);
  });

  it("переспрос находит живой ход и ответ доходит до конца", async () => {
    const { p, ws } = await connect();
    ws.emit("close");
    await vi.advanceTimersByTimeAsync(600);
    const second = FakeWebSocket.instances.at(-1)!;
    second.emit("open");
    await vi.advanceTimersByTimeAsync(0);

    const ask = second.sent.map((raw) => JSON.parse(raw)).find((f) => f.type === "turn.resume");
    second.frame({
      type: "turn.resume",
      id: ask.id,
      payload: { active: false, returned: 0, frames: [] },
    });
    await vi.advanceTimersByTimeAsync(6_500);

    // Ход на сервере всё-таки идёт — ответ приходит на переспрос.
    second.frame({ type: "message.create", payload: { content: "поздний ответ", message_id: "m8" } });
    await vi.advanceTimersByTimeAsync(QUIET);
    await expect(p).resolves.toMatchObject({ reply: "поздний ответ" });
  });
});
