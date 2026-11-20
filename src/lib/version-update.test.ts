import { describe, expect, it, vi } from "vitest";
import { watchForUpdate, type UpdateSource } from "./version-update";

function source(controller: unknown) {
  const listeners: Array<() => void> = [];
  const sw: UpdateSource = {
    controller,
    addEventListener: (type, listener) => {
      if (type === "controllerchange") listeners.push(listener);
    },
  };
  return { sw, fire: () => listeners.forEach((fn) => fn()), count: () => listeners.length };
}

describe("version-update: плашка «доступна новая версия»", () => {
  it("после обновления service worker зовёт onReady", () => {
    const onReady = vi.fn();
    const { sw, fire, count } = source({ scriptURL: "sw.js" });

    watchForUpdate(onReady, sw);
    expect(count()).toBe(1);

    fire();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("первая установка (контроллера не было) не считается обновлением", () => {
    const onReady = vi.fn();
    const { sw, count } = source(null);

    watchForUpdate(onReady, sw);
    expect(count()).toBe(0);
    expect(onReady).not.toHaveBeenCalled();
  });

  it("окружение без service worker — молча ничего не делает", () => {
    const onReady = vi.fn();
    expect(() => watchForUpdate(onReady, null)).not.toThrow();
    expect(onReady).not.toHaveBeenCalled();
  });
});
