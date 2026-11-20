/**
 * Очередь реплик: что сохраняем в IndexedDB и что поднимаем обратно.
 *
 * Главное правило: тяжёлые data-URL картинок в базу не едут. Поэтому после
 * перезагрузки реплика возвращается с текстом и документами, а картинки —
 * нет, и мы это честно показываем пользователю.
 */
import { describe, expect, it } from "vitest";
import {
  isPersistedQueue,
  readQueued,
  restoreQueued,
  toPersisted,
  type PersistedQueue,
  type QueueSource,
} from "./queue";
import type { PreparedDocument } from "./documents";

function doc(name: string): PreparedDocument {
  return { kind: "text", name, bytes: 12, text: `текст ${name}`, truncated: false };
}

function source(overrides: Partial<QueueSource> = {}): QueueSource {
  return {
    id: "q1",
    sessionId: "s1",
    persist: true,
    text: "проверь отчёт",
    images: [],
    docs: [],
    ...overrides,
  };
}

function record(overrides: Partial<PersistedQueue> = {}): PersistedQueue {
  return {
    id: "q1",
    sessionId: "s1",
    persist: true,
    text: "проверь отчёт",
    docs: [],
    imagesDropped: 0,
    at: 1000,
    ...overrides,
  };
}

describe("toPersisted", () => {
  it("сохраняет текст и документы, картинки заменяет счётчиком", () => {
    const persisted = toPersisted(
      source({ images: [{}, {}], docs: [doc("а.pdf")] }),
      5000,
    );
    expect(persisted.text).toBe("проверь отчёт");
    expect(persisted.docs).toHaveLength(1);
    expect(persisted.docs[0].name).toBe("а.pdf");
    expect(persisted.imagesDropped).toBe(2);
    expect(persisted.at).toBe(5000);
  });

  it("не перетирает исходное время постановки в очередь", () => {
    expect(toPersisted(source({ at: 111 }), 999).at).toBe(111);
  });

  it("копирует документы, а не отдаёт ссылку на состояние композера", () => {
    const original = doc("б.docx");
    const persisted = toPersisted(source({ docs: [original] }), 1);
    expect(persisted.docs[0]).not.toBe(original);
    expect(persisted.docs[0].text).toBe(original.text);
  });
});

describe("restoreQueued", () => {
  it("возвращает реплику с текстом и документами", () => {
    const restored = restoreQueued(record({ docs: [doc("в.xlsx")], imagesDropped: 1 }));
    expect(restored?.text).toBe("проверь отчёт");
    expect(restored?.docs).toHaveLength(1);
    expect(restored?.imagesDropped).toBe(1);
    expect(restored?.at).toBe(1000);
  });

  it("выбрасывает реплику, от которой остались только картинки", () => {
    expect(restoreQueued(record({ text: "   ", docs: [], imagesDropped: 2 }))).toBeNull();
  });

  it("реплика без текста, но с документом — отправляемая", () => {
    expect(restoreQueued(record({ text: "", docs: [doc("г.txt")] }))?.docs).toHaveLength(1);
  });

  it("битые документы отфильтровывает", () => {
    const broken = {
      ...record({ text: "" }),
      docs: [{ name: "x", text: 1 }],
    } as unknown as PersistedQueue;
    expect(restoreQueued(broken)).toBeNull();
  });
});

describe("isPersistedQueue", () => {
  it("принимает корректную запись", () => {
    expect(isPersistedQueue(record())).toBe(true);
  });

  it("отбрасывает мусор и записи без обязательных полей", () => {
    for (const value of [null, undefined, 42, "строка", {}, { id: "" }, { ...record(), at: NaN }]) {
      expect(isPersistedQueue(value)).toBe(false);
    }
  });
});

describe("readQueued", () => {
  it("сортирует по времени постановки", () => {
    const result = readQueued([record({ id: "b", at: 2000 }), record({ id: "a", at: 1000 })]);
    expect(result.items.map((item) => item.id)).toEqual(["a", "b"]);
    expect(result.skipped).toBe(0);
  });

  it("выбрасывает битые записи и считает картинки", () => {
    const result = readQueued([
      record({ id: "a", at: 1, imagesDropped: 2 }),
      { id: "b" },
      record({ id: "c", at: 3, text: " ", docs: [] }),
    ]);
    expect(result.items.map((item) => item.id)).toEqual(["a"]);
    expect(result.lostImages).toBe(2);
    expect(result.skipped).toBe(2);
  });

  it("из двух записей с одним id оставляет свежую", () => {
    const result = readQueued([
      record({ id: "same", at: 100, text: "старая" }),
      record({ id: "same", at: 200, text: "новая" }),
    ]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].text).toBe("новая");
    expect(result.skipped).toBe(1);
  });

  it("на не-массив отвечает пустой очередью", () => {
    expect(readQueued({})).toEqual({ items: [], lostImages: 0, skipped: 0 });
    expect(readQueued(undefined)).toEqual({ items: [], lostImages: 0, skipped: 0 });
  });
});
