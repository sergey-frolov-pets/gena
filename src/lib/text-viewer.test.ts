import { describe, expect, it } from "vitest";

import {
  escapeHtml,
  fileExtension,
  guessDelimiter,
  parseDelimited,
  prettyJson,
  rowsToMarkdown,
  viewerHtml,
  viewerKindOf,
} from "./text-viewer";

describe("fileExtension", () => {
  it("берёт расширение без пути, query и верхнего регистра", () => {
    expect(fileExtension("report.md")).toBe("md");
    expect(fileExtension("docs/Отчёт.MD")).toBe("md");
    expect(fileExtension("/pico/media/abc.csv?x=1")).toBe("csv");
    expect(fileExtension("README")).toBe("");
    expect(fileExtension(".env")).toBe("");
  });
});

describe("viewerKindOf", () => {
  it("markdown, таблицы и текст открываются на чтение", () => {
    expect(viewerKindOf("plan.md")).toBe("markdown");
    expect(viewerKindOf("plan.markdown")).toBe("markdown");
    expect(viewerKindOf("rows.csv")).toBe("table");
    expect(viewerKindOf("rows.tsv")).toBe("table");
    expect(viewerKindOf("notes.txt")).toBe("text");
    expect(viewerKindOf("data.json")).toBe("text");
    expect(viewerKindOf("config.yml")).toBe("text");
  });

  it("имя важнее MIME: octet-stream у .md не мешает рендеру", () => {
    expect(viewerKindOf("plan.md", "application/octet-stream")).toBe("markdown");
  });

  it("вложения без расширения распознаются по MIME", () => {
    expect(viewerKindOf("attach", "text/markdown")).toBe("markdown");
    expect(viewerKindOf("attach", "text/csv")).toBe("table");
    expect(viewerKindOf("attach", "application/json")).toBe("text");
    expect(viewerKindOf("attach", "text/plain; charset=utf-8")).toBe("text");
  });

  it("двоичные файлы просмотра не имеют", () => {
    expect(viewerKindOf("doc.pdf", "application/pdf")).toBeNull();
    expect(viewerKindOf("photo.jpg", "image/jpeg")).toBeNull();
    expect(viewerKindOf("archive.zip", "application/zip")).toBeNull();
  });
});

describe("parseDelimited", () => {
  it("понимает кавычки, запятые внутри и переводы строк", () => {
    const rows = parseDelimited('a,b\n"1,5","две\nстроки"\n"он ""сказал"""', ",");
    expect(rows).toEqual([
      ["a", "b"],
      ["1,5", "две\nстроки"],
      ['он "сказал"'],
    ]);
  });

  it("отбрасывает пустые строки", () => {
    expect(parseDelimited("a;b\n\n\n1;2\n", ";")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("разделитель угадывается по первой строке", () => {
    expect(guessDelimiter("a;b;c\n1;2;3", "csv")).toBe(";");
    expect(guessDelimiter("a,b,c\n1,2,3", "csv")).toBe(",");
    expect(guessDelimiter("a\tb", "tsv")).toBe("\t");
  });
});

describe("rowsToMarkdown", () => {
  it("первая строка — заголовок, экранирует вертикальные черты", () => {
    const md = rowsToMarkdown([
      ["Тикер", "Доля"],
      ["SBER | банк", "10%"],
    ]);
    expect(md.split("\n")[0]).toBe("| Тикер | Доля |");
    expect(md).toContain("| SBER \\| банк | 10% |");
  });

  it("пустая таблица не превращается в мусор", () => {
    expect(rowsToMarkdown([])).toBe("");
  });
});

describe("viewerHtml", () => {
  it("markdown рендерится заголовком", () => {
    const html = viewerHtml("markdown", "# План\n\n- пункт");
    expect(html).toContain("<h1");
    expect(html).toContain("<li>");
  });

  it("таблица csv приходит как md-table", () => {
    const html = viewerHtml("table", "a,b\n1,2", {}, { name: "t.csv" });
    expect(html).toContain('class="md-table"');
    expect(html).toContain("<table");
  });

  it("обычный текст экранируется, а не исполняется", () => {
    const html = viewerHtml("text", "<b>не тег</b> & так");
    expect(html).toContain("&lt;b&gt;не тег&lt;/b&gt; &amp; так");
    expect(html).not.toContain("<b>");
  });

  it("json форматируется, мусор остаётся текстом", () => {
    expect(viewerHtml("text", '{"a":1}', {}, { name: "d.json" })).toContain("&quot;a&quot;: 1");
    expect(viewerHtml("text", "{не json", {}, { name: "d.json" })).toContain("{не json");
  });
});

describe("escapeHtml / prettyJson", () => {
  it("escapeHtml закрывает пять опасных символов", () => {
    expect(escapeHtml('<a href="x">&\'')).toBe("&lt;a href=&quot;x&quot;&gt;&amp;'");
  });

  it("prettyJson не падает на невалидном вводе", () => {
    expect(prettyJson("[1,2]")).toBe("[\n  1,\n  2\n]");
    expect(prettyJson("nope")).toBe("nope");
  });
});
