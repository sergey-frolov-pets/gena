import { describe, expect, it } from "vitest";
import { renderMarkdown, sanitizeHtml } from "./markdown";

describe("renderMarkdown", () => {
  it("рендерит заголовки, жирный и списки", () => {
    const html = renderMarkdown("# Заголовок\n\n**жирный** и *курсив*\n\n- один\n- два");
    expect(html).toContain("<h1>Заголовок</h1>");
    expect(html).toContain("<strong>жирный</strong>");
    expect(html).toContain("<em>курсив</em>");
    expect(html).toContain("<li>один</li>");
  });

  it("код-блок — панель с шапкой и кнопкой копирования, содержимое экранировано", () => {
    const html = renderMarkdown("```ts\nconst a = 1 < 2;\n```", { copy: "Копировать" });
    expect(html).toContain('class="md-code"');
    expect(html).toContain('class="md-code__copy" type="button"');
    expect(html).toContain('aria-label="Копировать"');
    expect(html).toContain('<span class="md-code__lang">ts</span>');
    expect(html).toContain("const a = 1 &lt; 2;");
    expect(html).not.toContain("<code>const a = 1 < 2;");
  });

  it("таблица обёрнута в контейнер с горизонтальным скроллом", () => {
    const html = renderMarkdown("| a | b |\n| - | - |\n| 1 | 2 |");
    expect(html).toContain('<div class="md-table"><div class="md-table__scroll"><table>');
    expect(html).toContain('class="md-table__tools"');
    expect(html).toContain('class="md-table__tool md-table__copy"');
    expect(html).toContain('class="md-table__tool md-table__csv"');
    expect(html).toContain('class="md-table__tool md-table__xlsx"');
    expect(html).not.toMatch(/md-table__tool[^>]*>[^<]/);
    expect(html).toContain("<th>a</th>");
  });

  it("LaTeX не подключается: формула остаётся текстом", () => {
    const html = renderMarkdown("$\\frac{1}{2}$ и $$x^2$$");
    expect(html).not.toContain("<math");
    expect(html).not.toContain("katex");
    expect(html).toContain("\\frac{1}{2}");
  });

  it("inline-код и ссылки", () => {
    const html = renderMarkdown("`code` и [сайт](https://example.com)");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("картинка отдаётся ссылкой, а не загружается", () => {
    const html = renderMarkdown("![лого](https://example.com/logo.png)");
    expect(html).not.toContain("<img");
    expect(html).toContain('href="https://example.com/logo.png"');
  });

  it("повторный вызов отдаёт тот же результат (кеш)", () => {
    const first = renderMarkdown("**тест**");
    const second = renderMarkdown("**тест**");
    expect(second).toBe(first);
  });
});

describe("ссылки не съедают текст после себя", () => {
  it("голый URL — ссылка только сам URL", () => {
    const html = renderMarkdown("смотри https://example.com/x?a=1 а потом ещё текст");
    expect(html).toContain("</a>");
    expect(html).toContain("</a> а потом ещё текст");
  });

  it("markdown-ссылка закрывается до хвоста реплики", () => {
    const html = renderMarkdown("[ссылка](https://example.com) и хвост после неё");
    expect(html).toContain("</a> и хвост после неё");
  });

  it("закрывающий </a> не вырезается санитайзером", () => {
    const html = sanitizeHtml('<a href="https://ok.ru">x</a>хвост');
    expect(html.endsWith("</a>хвост")).toBe(true);
  });

  it("одиночный </a> без открывающего по-прежнему выбрасывается", () => {
    expect(sanitizeHtml("текст</a> ещё")).toBe("текст ещё");
  });

  it("незакрытый <a> в сыром HTML закрывается сам", () => {
    const html = sanitizeHtml('<a href="https://ok.ru">x');
    expect(html.startsWith('<a href="https://ok.ru"')).toBe(true);
    expect(html.endsWith(">x</a>")).toBe(true);
  });
});

describe("sanitizeHtml", () => {
  it("вырезает script и оставляет текст", () => {
    const html = sanitizeHtml("<script>alert(1)</script>после");
    expect(html).not.toContain("<script");
    expect(html).toContain("alert(1)");
    expect(html).toContain("после");
  });

  it("вырезает img и обработчики событий", () => {
    expect(sanitizeHtml('<img src="x" onerror="alert(1)">')).toBe("");
    expect(sanitizeHtml('<b onclick="alert(1)">т</b>')).toBe("<b>т</b>");
  });

  it("не пропускает javascript: и entity-обходы", () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe("x");
    expect(sanitizeHtml('<a href="java&#115;cript:alert(1)">x</a>')).toBe("x");
    expect(sanitizeHtml('<a href="java\tscript:alert(1)">x</a>')).toBe("x");
    expect(sanitizeHtml('<a href="https://ok.ru">x</a>')).toContain('href="https://ok.ru"');
  });

  it("оставляет только md-классы", () => {
    const html = sanitizeHtml('<div class="chat-panel__secret md-table" style="color:red">x</div>');
    expect(html).toBe('<div class="md-table">x</div>');
  });

  it("кнопка без md-класса вырезается", () => {
    expect(sanitizeHtml('<button class="x">y</button>')).toBe("y");
    expect(sanitizeHtml('<button class="md-code__copy" type="button">y</button>')).toContain(
      'class="md-code__copy"',
    );
  });

  it("комментарии и iframe удаляются", () => {
    expect(sanitizeHtml("<!-- скрыто -->a")).toBe("a");
    expect(sanitizeHtml('<iframe src="https://x"></iframe>b')).toBe("b");
  });
});
