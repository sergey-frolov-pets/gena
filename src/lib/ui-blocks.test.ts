import { describe, expect, it } from "vitest";
import { parseBlock, serializeBlock, splitContent, validateBlock } from "./ui-blocks";
import { hasUiBlock, textOnly } from "./ui-text";
import { MAX_BLOCK_BYTES, MAX_ITEMS, MAX_STRING, type UiBlock } from "@/plugins/types";

const block: UiBlock = {
  v: 1,
  plugin: "ozadachnik.tasks",
  title: "Задачи",
  data: {
    items: [
      { id: "a1", title: "Дописать план плагинов", status: "in_progress", due: "20.11" },
      { id: "a2", title: "Ротация GitHub-токена", status: "todo", due: "21.11" },
    ],
  },
  actions: [
    { id: "done", label: "Готово", scope: "item", style: "primary", send: "задача {id} выполнена" },
    { id: "refresh", label: "Обновить", scope: "view", hidden: true, send: "[ui:ozadachnik.tasks]" },
  ],
};

function fence(json: string, extra = ""): string {
  return `\n\n\`\`\`gena-ui\n${json}\n\`\`\`${extra}`;
}

describe("splitContent", () => {
  it("валидный блок последним: текст очищен, блок разобран", () => {
    const parts = splitContent(`Задачи на сегодня, 2 штуки.${fence(JSON.stringify(block))}`);
    expect(parts.block?.plugin).toBe("ozadachnik.tasks");
    expect(parts.block?.data.items).toHaveLength(2);
    expect(parts.block?.actions[1].hidden).toBe(true);
    expect(parts.text).toBe("Задачи на сегодня, 2 штуки.");
    expect(parts.issues).toHaveLength(0);
  });

  it("битый JSON — fallback в текст, сообщение не ломается", () => {
    const content = `Смотри.${fence('{"v":1,"plugin":"ozadachnik.tasks",')}`;
    const parts = splitContent(content);
    expect(parts.block).toBeNull();
    expect(parts.text).toBe(content);
    expect(parts.issues[0].code).toBe("bad-json");
  });

  it("неизвестный плагин — fallback в текст", () => {
    const parts = splitContent(`Текст${fence(JSON.stringify({ ...block, plugin: "unknown.thing" }))}`);
    expect(parts.block).toBeNull();
    expect(parts.issues[0]).toMatchObject({ code: "unknown-plugin", detail: "unknown.thing" });
  });

  it("два блока: берётся последний, лишний отмечен в issues", () => {
    const first = fence(JSON.stringify({ ...block, title: "Первый" })).trimEnd();
    const content = `Резюме.${first}${fence(JSON.stringify(block))}`;
    const parts = splitContent(content);
    expect(parts.block?.title).toBe("Задачи");
    expect(parts.issues.some((issue) => issue.code === "extra-blocks")).toBe(true);
    // ранний блок остаётся в тексте как есть
    expect(parts.text).toContain('"Первый"');
  });

  it("блок не последний — не принимаем", () => {
    const content = `Текст${fence(JSON.stringify(block))}\n\nИ ещё немного текста после.`;
    const parts = splitContent(content);
    expect(parts.block).toBeNull();
    expect(parts.text).toBe(content);
    expect(parts.issues[0].code).toBe("block-not-last");
  });

  it("слишком большой блок — не принимаем", () => {
    const huge = JSON.stringify({ ...block, title: "x".repeat(MAX_BLOCK_BYTES + 10) });
    expect(new TextEncoder().encode(huge).length).toBeGreaterThan(MAX_BLOCK_BYTES);
    const parts = splitContent(`Текст${fence(huge)}`);
    expect(parts.block).toBeNull();
    expect(parts.issues[0].code).toBe("too-large");
  });

  it("обычный текст без блока возвращается как есть", () => {
    const parts = splitContent("просто текст");
    expect(parts).toEqual({ text: "просто текст", block: null, issues: [] });
  });
});

describe("validateBlock", () => {
  it("версия не 1 — отказ", () => {
    expect(validateBlock({ ...block, v: 2 })).toMatchObject({ ok: false, code: "bad-version" });
  });

  it("пустой заголовок задачи отбрасывается, id берётся из title", () => {
    const result = validateBlock({
      ...block,
      data: { items: [{ title: "Без id" }, { id: "b", title: "  " }] },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.block.data.items).toEqual([{ id: "Без id", title: "Без id" }]);
  });

  it("длинные строки обрезаются, лишние items не проходят", () => {
    const items = Array.from({ length: MAX_ITEMS + 5 }, (_, i) => ({ id: `i${i}`, title: `Задача ${i}` }));
    const result = validateBlock({ ...block, data: { items }, actions: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.block.data.items).toHaveLength(MAX_ITEMS);

    const long = validateBlock({ ...block, title: "я".repeat(MAX_STRING * 2), data: { items: [] }, actions: [] });
    expect(long.ok).toBe(true);
    if (!long.ok) return;
    expect(long.block.title!.length).toBeLessThanOrEqual(120);
  });

  it("небезопасная ссылка и неверный scope чистятся", () => {
    const result = validateBlock({
      ...block,
      data: { items: [{ id: "a", title: "Ссылка", url: "javascript:alert(1)" }] },
      actions: [{ id: "x", label: "X", scope: "hack", send: "go" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.block.data.items?.[0].url).toBeUndefined();
    expect(result.block.actions[0].scope).toBe("item");
  });

  it("не объект и не массив — bad-shape", () => {
    expect(validateBlock(null)).toMatchObject({ ok: false, code: "bad-shape" });
    expect(validateBlock([1, 2])).toMatchObject({ ok: false, code: "bad-shape" });
    expect(validateBlock({ v: 1, plugin: "плохой id!" })).toMatchObject({ ok: false, code: "bad-shape" });
  });
});

describe("serialize / textOnly", () => {
  it("serializeBlock → parseBlock возвращает тот же блок", () => {
    const text = serializeBlock(block);
    const parsed = parseBlock(text.split("\n").slice(1, -1).join("\n"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.block.plugin).toBe(block.plugin);
    expect(parsed.block.data.items).toHaveLength(2);
  });

  it("textOnly вырезает блок и не трогает обычный текст", () => {
    expect(textOnly(`Резюме.${fence(JSON.stringify(block))}`)).toBe("Резюме.");
    expect(textOnly("обычный ответ")).toBe("обычный ответ");
    expect(textOnly("")).toBe("");
  });

  it("hasUiBlock: true только для принятого блока", () => {
    expect(hasUiBlock(`Резюме.${fence(JSON.stringify(block))}`)).toBe(true);
    expect(hasUiBlock(`Резюме.${fence("{битый")}`)).toBe(false);
    expect(hasUiBlock("просто текст")).toBe(false);
  });

  it("битый блок в textOnly остаётся текстом, а не теряется", () => {
    const content = `Резюме.${fence("{битый")}`;
    expect(textOnly(content)).toBe(content);
  });
});
