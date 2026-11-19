/**
 * Извлечение текста из вложений: txt/docx/xlsx на настоящих файлах-фикстурах.
 * pdf проверяется только по выбору формата — парсер тянет браузерный воркер.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DocumentError,
  documentKindOf,
  documentsToMessage,
  formatBytes,
  prepareDocument,
} from "./documents";

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../test/fixtures/${name}`, import.meta.url));
}

async function fixtureFile(name: string, type = ""): Promise<File> {
  const buffer = await readFile(fixturePath(name));
  return new File([new Uint8Array(buffer)], name, { type });
}

describe("documentKindOf", () => {
  it("узнаёт форматы по расширению", () => {
    expect(documentKindOf({ name: "заметки.md" })).toBe("text");
    expect(documentKindOf({ name: "table.CSV" })).toBe("text");
    expect(documentKindOf({ name: "doc.pdf" })).toBe("pdf");
    expect(documentKindOf({ name: "doc.docx" })).toBe("docx");
    expect(documentKindOf({ name: "sheET.xlsx" })).toBe("xlsx");
  });

  it("узнаёт pdf/docx/xlsx по MIME без расширения", () => {
    expect(documentKindOf({ name: "scan", type: "application/pdf" })).toBe("pdf");
    expect(
      documentKindOf({
        name: "file",
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    ).toBe("docx");
  });

  it("остальное — null", () => {
    expect(documentKindOf({ name: "app.exe" })).toBeNull();
    expect(documentKindOf({ name: "photo.png", type: "image/png" })).toBeNull();
  });
});

describe("prepareDocument", () => {
  it("читает текстовый файл", async () => {
    const doc = await prepareDocument(await fixtureFile("note.txt", "text/plain"));
    expect(doc.kind).toBe("text");
    expect(doc.text).toContain("Вторая строка");
    expect(doc.truncated).toBe(false);
  });

  it("достаёт текст из docx (zip + deflate)", async () => {
    const doc = await prepareDocument(await fixtureFile("sample.docx"));
    expect(doc.kind).toBe("docx");
    expect(doc.text).toContain("Привет, Gena & Pico");
    expect(doc.text).toContain("Второй абзац");
    expect(doc.text).toContain("после табуляции");
  });

  it("достаёт строки из xlsx по листам", async () => {
    const doc = await prepareDocument(await fixtureFile("sample.xlsx"));
    expect(doc.kind).toBe("xlsx");
    expect(doc.text).toContain("# Данные");
    expect(doc.text).toContain("Тикер,Цена");
    expect(doc.text).toContain("SBER,270.5");
    expect(doc.text).toContain("# Итоги");
    expect(doc.text).toContain("Итог");
  });

  it("пустой файл — ошибка empty", async () => {
    const empty = new File(["   \n  "], "empty.txt", { type: "text/plain" });
    await expect(prepareDocument(empty)).rejects.toMatchObject({ code: "empty" });
  });

  it("неподдержанный формат — ошибка unsupported", async () => {
    const bad = new File(["bin"], "app.exe");
    await expect(prepareDocument(bad)).rejects.toBeInstanceOf(DocumentError);
    await expect(prepareDocument(bad)).rejects.toMatchObject({ code: "unsupported" });
  });

  it("слишком большой файл — ошибка too_large", async () => {
    const big = new File([new Uint8Array(10)], "big.txt", { type: "text/plain" });
    Object.defineProperty(big, "size", { value: 26 * 1024 * 1024 });
    await expect(prepareDocument(big)).rejects.toMatchObject({ code: "too_large" });
  });
});

describe("сообщение агенту", () => {
  it("склеивает текст пользователя и содержимое файлов", async () => {
    const doc = await prepareDocument(await fixtureFile("note.txt", "text/plain"));
    const message = documentsToMessage("Смотри файл", [doc]);
    expect(message.startsWith("Смотри файл")).toBe(true);
    expect(message).toContain("=== note.txt");
    expect(message).toContain("Первая строка");
  });

  it("без текста и файлов — пустая строка", () => {
    expect(documentsToMessage("  ", [])).toBe("");
  });

  it("formatBytes печатает читаемый размер", () => {
    expect(formatBytes(512)).toBe("512 Б");
    expect(formatBytes(2048)).toBe("2.0 КБ");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 МБ");
  });
});
