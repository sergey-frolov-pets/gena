/**
 * Markdown для ленты чата Gena.
 *
 * Правила (решение Сергея, 20.11.2026):
 *  - поддерживается обычный markdown + GFM-таблицы;
 *  - LaTeX НЕ поддерживается: `$…$` и `$$…$$` остаются текстом;
 *  - базовый HTML разрешён, но только по allowlist тегов и атрибутов;
 *  - блок кода — отдельная панель с шапкой (язык + кнопка «Копировать»);
 *  - таблица — в контейнере с горизонтальным скроллом на телефоне.
 *
 * Санитайзер строковый (без DOM): тесты гоняются в node-окружении vitest.
 */
import { Marked, type Tokens } from "marked";

export interface MarkdownLabels {
  copy?: string;
  copied?: string;
  tableCopy?: string;
  tableCsv?: string;
  tableXlsx?: string;
}

/** Теги, которые разрешены в выводе. Всё остальное вырезается, текст остаётся. */
const ALLOWED_TAGS = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "button",
  "code",
  "del",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "span",
  "strike",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);

/** Атрибуты, которые разрешено оставлять (остальные отбрасываются). */
const ALLOWED_ATTRS = new Set([
  "class",
  "href",
  "aria-label",
  "title",
  "type",
  "data-name",
  "data-start",
  "data-end",
]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  colon: ":",
  gt: ">",
  lt: "<",
  quot: '"',
  tab: "\t",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16) || 0),
    )
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10) || 0))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

/** Только http(s) и mailto; entity-кодирование и пробелы/юникод-трюки разбираются. */
function safeHref(raw: string): string | null {
  const decoded = decodeEntities(raw).trim();
  if (!decoded) return null;
  // Управляющие символы и пробелы внутри схемы — типичный обход `java\tscript:`.
  const normalized = decoded.replace(/[\u0000-\u0020\u007f]+/g, "").toLowerCase();
  if (
    normalized.startsWith("http://") ||
    normalized.startsWith("https://") ||
    normalized.startsWith("mailto:")
  ) {
    return escapeHtml(decoded);
  }
  return null;
}

/** Классы оставляем только наши, с префиксом `md-`: чужой CSS не подмешать. */
function safeClass(value: string): string {
  const tokens = decodeEntities(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => /^md-[a-z0-9_-]+$/i.test(token));
  return tokens.length ? tokens.join(" ") : "";
}

interface ParsedAttr {
  name: string;
  value: string;
}

function parseAttrs(raw: string): ParsedAttr[] {
  const result: ParsedAttr[] = [];
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    const name = match[1].toLowerCase();
    const value = (match[2] ?? "").replace(/^["']|["']$/g, "");
    result.push({ name, value });
  }
  return result;
}

function buildAttrs(tag: string, raw: string): { attrs: string; dropTag: boolean } {
  const parts: string[] = [];
  let hasMdClass = false;
  let href: string | null = null;

  for (const { name, value } of parseAttrs(raw)) {
    if (!ALLOWED_ATTRS.has(name)) continue;
    if (name === "class") {
      const klass = safeClass(value);
      if (!klass) continue;
      hasMdClass = true;
      parts.push(`class="${klass}"`);
      continue;
    }
    if (name === "href") {
      const safe = safeHref(value);
      if (safe) href = safe;
      continue;
    }
    if (name === "type") {
      if (value.trim().toLowerCase() === "button") parts.push('type="button"');
      continue;
    }
    if (name === "aria-label" || name === "title") {
      parts.push(`${name}="${escapeHtml(decodeEntities(value))}"`);
      continue;
    }
    if (name === "data-name") {
      const label = decodeEntities(value).trim();
      if (label && label.length <= 80 && !/[<>"']/.test(label)) {
        parts.push(`data-name="${escapeHtml(label)}"`);
      }
      continue;
    }
    if ((name === "data-start" || name === "data-end") && /^\d+$/.test(value.trim())) {
      parts.push(`${name}="${value.trim()}"`);
    }
  }

  if (tag === "a") {
    if (!href) return { attrs: "", dropTag: true };
    return { attrs: ` href="${href}" target="_blank" rel="noopener noreferrer"`, dropTag: false };
  }
  // Кнопка имеет смысл только наша: внешние ссылки со своими кнопками не нужны.
  if (tag === "button" && !hasMdClass) return { attrs: "", dropTag: true };
  return { attrs: parts.length ? ` ${parts.join(" ")}` : "", dropTag: false };
}

/**
 * Строковый санитайзер: оставляет только разрешённые теги и атрибуты.
 * Неразрешённые теги удаляются целиком, их текст остаётся.
 */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(
      /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g,
      (_match, slash: string, rawName: string, rawAttrs: string) => {
        const tag = rawName.toLowerCase();
        if (!ALLOWED_TAGS.has(tag)) return "";
        if (slash) return `</${tag}>`;
        const { attrs, dropTag } = buildAttrs(tag, rawAttrs);
        if (dropTag) return "";
        return `<${tag}${attrs}>`;
      },
    )
    // Одиночные `</a>`/`</button>`, от которых открывающий тег был вырезан.
    .replace(/<\/(?:a|button)>/g, "");
}

interface ParserBundle {
  marked: Marked;
}

const parsers = new Map<string, ParserBundle>();

function getParser(labels: MarkdownLabels): ParserBundle {
  const key = `${labels.copy ?? ""}\u0000${labels.copied ?? ""}`;
  const cached = parsers.get(key);
  if (cached) return cached;

  const copyLabel = labels.copy || "Copy";
  const marked = new Marked({
    gfm: true,
    breaks: true,
    async: false,
  });

  marked.use({
    renderer: {
      code(token: Tokens.Code) {
        const lang = (token.lang ?? "").trim().split(/\s+/)[0] ?? "";
        const langLabel = escapeHtml(lang || "code");
        return (
          '<div class="md-code">' +
          '<div class="md-code__head">' +
          `<span class="md-code__lang">${langLabel}</span>` +
          `<button class="md-code__copy" type="button" aria-label="${escapeHtml(copyLabel)}" title="${escapeHtml(copyLabel)}"></button>` +
          "</div>" +
          `<pre class="md-code__pre"><code>${escapeHtml(token.text)}</code></pre>` +
          "</div>"
        );
      },
      // Картинки из markdown не грузим (чужой трекер в чате) — отдаём ссылкой.
      image(token: Tokens.Image) {
        const href = safeHref(token.href ?? "");
        const alt = escapeHtml(token.text ?? "");
        if (!href) return alt;
        return `<a href="${href}" target="_blank" rel="noopener noreferrer">${alt || href}</a>`;
      },
      link(token: Tokens.Link) {
        const href = safeHref(token.href ?? "");
        if (!href) return token.text ?? "";
        return `<a href="${href}" target="_blank" rel="noopener noreferrer">${token.text ?? ""}</a>`;
      },
    },
  });

  const bundle: ParserBundle = { marked };
  parsers.set(key, bundle);
  return bundle;
}

const cache = new Map<string, string>();
const CACHE_LIMIT = 300;

/**
 * Markdown → безопасный HTML.
 * Результат кешируется по тексту: стрим и перерисовка ленты не парсят заново.
 */
export function renderMarkdown(text: string, labels: MarkdownLabels = {}): string {
  if (!text) return "";
  const key = [
    labels.copy ?? "",
    labels.copied ?? "",
    labels.tableCopy ?? "",
    labels.tableCsv ?? "",
    labels.tableXlsx ?? "",
    text,
  ].join("\u0000");
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const { marked } = getParser(labels);
  const raw = marked.parse(text, { async: false }) as string;
  // Таблицу оборачиваем в контейнер с горизонтальным скроллом.
  const tools = tableTools(labels);
  const wrapped = raw
    .replace(/<table\b/g, '<div class="md-table"><div class="md-table__scroll"><table')
    .replace(/<\/table>/g, `</table></div>${tools}</div>`);
  const html = sanitizeHtml(wrapped);

  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, html);
  return html;
}

/** Иконки под таблицей: без текста внутри, чтобы не попасть в выделение. */
function tableTools(labels: MarkdownLabels): string {
  const button = (klass: string, label: string) =>
    `<button class="md-table__tool ${klass}" type="button" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"></button>`;
  return (
    '<div class="md-table__tools">' +
    button("md-table__copy", labels.tableCopy || "Copy") +
    button("md-table__csv", labels.tableCsv || "CSV") +
    button("md-table__xlsx", labels.tableXlsx || "XLSX") +
    "</div>"
  );
}

/** Сброс кеша — нужен тестам. */
export function resetMarkdownCache(): void {
  cache.clear();
  parsers.clear();
}
