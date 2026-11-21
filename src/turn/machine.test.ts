import { describe, expect, it } from "vitest";
import { canTakeNext, idleTurn, stepTurn } from "./machine";
import {
  draftKey,
  forgetPending,
  parsePending,
  pendingFor,
  readStoredText,
  rememberPending,
  writeStoredText,
  type TextStore,
} from "./draft";

function memoryStore(): TextStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

describe("автомат хода", () => {
  it("обрыв посреди стрима — переподключение, пока попытки не кончились", () => {
    let state = stepTurn(idleTurn(2), {
      type: "enqueue",
      clientTurnId: "t1",
      text: "привет",
    });
    state = stepTurn(state, { type: "start" });
    state = stepTurn(state, { type: "delta" });
    state = stepTurn(state, { type: "socketClosed" });
    expect(state.phase).toBe("reconnecting");
    expect(state.attempt).toBe(1);
    state = stepTurn(state, { type: "resume" });
    expect(state.phase).toBe("streaming");
    state = stepTurn(state, { type: "socketClosed" });
    expect(state.phase).toBe("reconnecting");
    state = stepTurn(state, { type: "socketClosed" });
    expect(state.phase).toBe("failed");
  });

  it("вторая реплика не стартует, пока первая не освободила ход", () => {
    let state = stepTurn(idleTurn(), {
      type: "enqueue",
      clientTurnId: "a",
      text: "первая",
    });
    state = stepTurn(state, { type: "start" });
    const blocked = stepTurn(state, {
      type: "enqueue",
      clientTurnId: "b",
      text: "вторая",
    });
    expect(blocked.clientTurnId).toBe("a");
    expect(canTakeNext(blocked.phase)).toBe(false);
    state = stepTurn(state, { type: "complete" });
    expect(canTakeNext(state.phase)).toBe(true);
    state = stepTurn(state, { type: "enqueue", clientTurnId: "b", text: "вторая" });
    expect(state.phase).toBe("queued");
    expect(state.text).toBe("вторая");
  });

  it("повтор того же clientTurnId не затирает уже идущий ход", () => {
    let state = stepTurn(idleTurn(), {
      type: "enqueue",
      clientTurnId: "same",
      text: "раз",
    });
    state = stepTurn(state, { type: "start" });
    state = stepTurn(state, {
      type: "enqueue",
      clientTurnId: "same",
      text: "раз",
    });
    expect(state.phase).toBe("sending");
  });
});

describe("черновик и pending", () => {
  it("pagehide с непустым композером читается обратно", () => {
    const storage = memoryStore();
    const key = draftKey("session-1");
    writeStoredText(storage, key, "не отправлено");
    expect(readStoredText(storage, key)).toBe("не отправлено");
    writeStoredText(storage, key, "");
    expect(readStoredText(storage, key)).toBe("");
  });

  it("тот же текст pending не дублируется и не сдвигает список", () => {
    const first = { sessionId: "s", text: "ход", at: 10 };
    const list = rememberPending([], first);
    const again = rememberPending(list, { ...first, at: 99 });
    expect(again).toEqual([first]);
    expect(pendingFor(again, "s")?.at).toBe(10);
    expect(parsePending(JSON.stringify(again))).toEqual(again);
    expect(forgetPending(again, "s", "ход")).toEqual([]);
  });
});
