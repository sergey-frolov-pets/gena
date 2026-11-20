/**
 * Стор `queue` (база gena, версия 3): очередь переживает перезапуск.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "./db";
import { clearQueued, listQueued, replaceQueued, type QueuedRecord } from "./queue";

function record(overrides: Partial<QueuedRecord> = {}): QueuedRecord {
  return {
    id: "q1",
    sessionId: "s1",
    persist: true,
    text: "привет",
    docs: [],
    imagesDropped: 0,
    at: 1000,
    ...overrides,
  };
}

describe("storage/queue", () => {
  beforeEach(async () => {
    await closeDb();
    await clearQueued();
  });

  it("сохраняет и читает реплики в порядке постановки", async () => {
    await replaceQueued([record({ id: "b", at: 2000 }), record({ id: "a", at: 1000 })]);
    const list = await listQueued();
    expect(list.map((item) => item.id)).toEqual(["a", "b"]);
    expect(list[0].text).toBe("привет");
  });

  it("replaceQueued переписывает очередь целиком", async () => {
    await replaceQueued([record({ id: "a" }), record({ id: "b" })]);
    await replaceQueued([record({ id: "c" })]);
    const list = await listQueued();
    expect(list.map((item) => item.id)).toEqual(["c"]);
  });

  it("clearQueued опустошает стор", async () => {
    await replaceQueued([record()]);
    await clearQueued();
    expect(await listQueued()).toEqual([]);
  });
});
