
import { describe, expect, it } from "vitest";
import {
  absoluteMediaUrl,
  fileAttachmentFromIncoming,
  filenameFromDisposition,
  getCachedMedia,
  mediaUrlCandidates,
  parseIncomingAttachments,
  resolveAttachmentName,
  withExtension,
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
      mime: "text/markdown",
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

describe("mediaUrlCandidates", () => {
  it("порядок: свой домен из сборки → origin страницы → домен агента", () => {
    const urls = mediaUrlCandidates(
      "wss://stats.code2graph.ru/pico/ws",
      "/pico/media/abc",
      "https://gena-ai.space",
    );
    expect(urls.slice(-2)).toEqual([
      "https://gena-ai.space/pico/media/abc",
      "https://stats.code2graph.ru/pico/media/abc",
    ]);
  });

  it("повторы не добавляются, пустой origin пропускается", () => {
    const urls = mediaUrlCandidates(
      "wss://stats.code2graph.ru/pico/ws",
      "/pico/media/abc",
      "https://stats.code2graph.ru",
    );
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls).toHaveLength(1);
  });
});

describe("filenameFromDisposition", () => {
  it("разбирает filename*=UTF-8''…", () => {
    const header = "attachment; filename=\"fallback.bin\"; filename*=UTF-8''%D0%BE%D1%82%D1%87%D1%91%D1%82.md";
    expect(filenameFromDisposition(header)).toBe("отчёт.md");
  });

  it("разбирает обычный filename в кавычках", () => {
    expect(filenameFromDisposition('attachment; filename="plan.pdf"')).toBe("plan.pdf");
  });

  it("без заголовка возвращает undefined", () => {
    expect(filenameFromDisposition(null)).toBeUndefined();
  });
});

describe("withExtension", () => {
  it("дописывает расширение по MIME, если его нет", () => {
    expect(withExtension("photo", "image/jpeg")).toBe("photo.jpg");
  });

  it("чинит врущий .bin", () => {
    expect(withExtension("photo.bin", "image/png")).toBe("photo.png");
  });

  it("не трогает правильное расширение и незнакомый MIME", () => {
    expect(withExtension("photo.JPEG", "image/jpeg")).toBe("photo.JPEG");
    expect(withExtension("data.unknown", "application/x-custom")).toBe("data.unknown");
  });
});

describe("resolveAttachmentName", () => {
  it("явное имя важнее заголовка и адреса", () => {
    expect(
      resolveAttachmentName("мой-файл", 'attachment; filename="x.pdf"', "https://h/pico/media/a", "application/pdf"),
    ).toBe("мой-файл.pdf");
  });

  it("без имени берёт имя из адреса и правит расширение", () => {
    expect(resolveAttachmentName("", null, "https://h/pico/media/abc123", "image/webp")).toBe("abc123.webp");
  });
});
