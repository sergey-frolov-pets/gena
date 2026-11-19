import { describe, expect, it } from "vitest";
import { absoluteMediaUrl, getCachedMedia, parseIncomingAttachments } from "./media";

describe("parseIncomingAttachments", () => {
  it("оставляет только изображения с непустым url", () => {
    const raw = [
      { type: "image", url: "/pico/media/abc", filename: "a.jpg", content_type: "image/jpeg" },
      { type: "file", url: "/pico/media/doc", filename: "a.pdf" },
      { type: "image", url: "   " },
      null,
      "мусор",
    ];
    expect(parseIncomingAttachments(raw)).toEqual([
      { url: "/pico/media/abc", filename: "a.jpg", contentType: "image/jpeg" },
    ]);
  });

  it("не-массив → пустой список", () => {
    expect(parseIncomingAttachments(undefined)).toEqual([]);
    expect(parseIncomingAttachments({ type: "image" })).toEqual([]);
  });
});

describe("absoluteMediaUrl", () => {
  it("ws/wss переводятся в http/https, путь сохраняется", () => {
    expect(absoluteMediaUrl("wss://pico.test", "/pico/media/abc")).toBe(
      "https://pico.test/pico/media/abc",
    );
    expect(absoluteMediaUrl("ws://127.0.0.1:8080/", "/pico/media/abc")).toBe(
      "http://127.0.0.1:8080/pico/media/abc",
    );
  });

  it("путь без ведущего слэша тоже работает", () => {
    expect(absoluteMediaUrl("https://pico.test/base", "pico/media/abc")).toBe(
      "https://pico.test/pico/media/abc",
    );
  });

  it("пустой адрес — ошибка", () => {
    expect(() => absoluteMediaUrl("", "/pico/media/abc")).toThrow();
  });
});

describe("getCachedMedia", () => {
  it("без скачивания возвращает undefined", () => {
    expect(getCachedMedia("wss://pico.test", "/pico/media/none")).toBeUndefined();
  });
});
