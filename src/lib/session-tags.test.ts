import { describe, expect, it } from "vitest";
import {
  MAX_TAG_LEN,
  MAX_TAGS,
  collectTags,
  filterByTag,
  formatTagsInput,
  hasTag,
  normalizeTag,
  normalizeTags,
  parseTagsInput,
} from "./session-tags";
import type { Session } from "@/storage/types";

function session(partial: Partial<Session> & { id: string }): Session {
  return {
    id: partial.id,
    agentId: partial.agentId ?? "a1",
    title: partial.title ?? "Диалог",
    createdAt: partial.createdAt ?? 1,
    updatedAt: partial.updatedAt ?? 1,
    messageCount: partial.messageCount ?? 0,
    pinned: partial.pinned,
    tags: partial.tags,
  };
}

describe("session-tags", () => {
  it("normalizeTag: решётка, лишние пробелы и длина", () => {
    expect(normalizeTag("#работа")).toBe("работа");
    expect(normalizeTag("  вклады   втб ")).toBe("вклады втб");
    expect(normalizeTag("   ")).toBe("");
    expect(normalizeTag("х".repeat(40))).toHaveLength(MAX_TAG_LEN);
  });

  it("normalizeTags: только строки, повторы без учёта регистра, лимит", () => {
    expect(normalizeTags(["Работа", "работа", "дом", 42, "", "  "])).toEqual(["Работа", "дом"]);
    const many = Array.from({ length: MAX_TAGS + 3 }, (_, i) => `t${i}`);
    expect(normalizeTags(many)).toHaveLength(MAX_TAGS);
  });

  it("parseTagsInput: запятые, точка с запятой и перевод строки", () => {
    expect(parseTagsInput("работа, личное; дом\nвклады")).toEqual([
      "работа",
      "личное",
      "дом",
      "вклады",
    ]);
    expect(parseTagsInput("  ,; \n")).toEqual([]);
  });

  it("formatTagsInput: обратно в строку для поля ввода", () => {
    expect(formatTagsInput(["работа", "дом"])).toBe("работа, дом");
    expect(formatTagsInput(undefined)).toBe("");
  });

  it("collectTags: уникальные теги без учёта регистра, по алфавиту", () => {
    const list = [
      session({ id: "1", tags: ["Работа", "дом"] }),
      session({ id: "2", tags: ["работа", "вклады"] }),
      session({ id: "3" }),
    ];
    expect(collectTags(list)).toEqual(["вклады", "дом", "Работа"].sort((a, b) => a.localeCompare(b)));
  });

  it("hasTag: пустой тег пропускает всё, регистр не важен", () => {
    const s = session({ id: "1", tags: ["Работа"] });
    expect(hasTag(s, "")).toBe(true);
    expect(hasTag(s, "работа")).toBe(true);
    expect(hasTag(s, "РАБОТА")).toBe(true);
    expect(hasTag(s, "дом")).toBe(false);
    expect(hasTag(session({ id: "2" }), "работа")).toBe(false);
  });

  it("filterByTag: пустой тег — весь список, иначе только совпадения", () => {
    const list = [
      session({ id: "1", tags: ["работа"] }),
      session({ id: "2", tags: ["дом"] }),
      session({ id: "3" }),
    ];
    expect(filterByTag(list, "").map((s) => s.id)).toEqual(["1", "2", "3"]);
    expect(filterByTag(list, "дом").map((s) => s.id)).toEqual(["2"]);
  });
});
