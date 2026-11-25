
import { describe, expect, it } from "vitest";
import {
  absoluteMediaUrl,
  fileAttachmentFromIncoming,
  getCachedMedia,
  parseIncomingAttachments,
} from "./media";

describe("parseIncomingAttachments", () => {
  it("принимает картинки и документы, мусор без url отбрасывает", () => {
    const raw = [
      { type: "image", url: "/pico/media/abc", filename: "a.jpg", content_type: "image/jpeg" },
      { type: "file", url: "/pico/media/doc", filename: "a.pdf", bytes: 1234 },
      { type: "image", url: "   " },
      null,
      "мусор",
    ];
    expect(parseIncomingAttachments(raw)).toEqual([
      {
        url: "/pico/media/abc",
        filename: "a.jpg",
        contentType: "image/jpeg",
        kind: "image",
        bytes: undefined,
      },
      {
        url: "/pico/media/doc",
        filename: "a.pdf",
        contentType: undefined,
        kind: "file",
        bytes: 1234,
      },
    ]);
  });

  it("audio и video считаются файлами, а не теряются", () => {
    const raw = [
      { type: "audio", url: "/pico/media/a1", filename: "voice.ogg" },
      { type: "video", url: "/pico/media/v1", filename: "clip.mp4" },
    ];
    expect(parseIncomingAttachments(raw).map((item) => item.kind)).toEqual(["file", "file"]);
  });

  it("без type, но с image-типом содержимого — картинка", () => {
    const raw = [{ url: "/pico/media/i1", content_type: "image/png" }];
    expect(parseIncomingAttachments(raw)[0].kind).toBe("image");
  });

  it("не-массив → пустой список", () => {
    expect(parseIncomingAttachments(undefined)).toEqual([]);
    expect(parseIncomingAttachments({ type: "image" })).toEqual([]);
  });
});

describe("fileAttachmentFromIncoming", () => {
  it("документ сохраняется без байтов: имя, размер, путь", () => {
    const attachment = fileAttachmentFromIncoming({
      url: "/pico/media/doc",
      filename: "plan.md",
      contentType: "text/markdown",
      kind: "file",
      bytes: 27777,
    });
    expect(attachment).toEqual({
      kind: "file",
      name: "plan.md",
      bytes: 27777,
      refUrl: "/pico/media/doc",
    });
  });

  it("пустое имя заменяется на file", () => {
    const attachment = fileAttachmentFromIncoming({
      url: "/pico/media/x",
      kind: "file",
    });
    expect(attachment.name).toBe("file");
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
