/**
 * Просмотр текстовых вложений в ленте чата.
 *
 * Плашка файла в ленте открывает модалку: markdown рендерится, csv/tsv
 * показываются таблицей, остальной текст — как есть в `<pre>`. Всегда остаётся
 * переключатель «Исходник»: рендер не должен мешать прочитать байты глазами.
 *
 * Здесь только чистые функции — их удобно тестировать без DOM.
 */
import { renderMarkdown, type MarkdownLabels } from "./markdown";

/** Как показывать файл: рендер markdown, таблица или монospaced текст. */
export type ViewerKind = "markdown" | "table" | "text";

/** Подписи просмотрщика: приходят из i18n, компонент остаётся без словаря. */
export interface ViewerLabels {
  expand: string;
  collapse: string;
  source: string;
  rendered: string;
  download: string;
  share: string;
  close: string;
  loading: string;
  error: string;
  empty: string;
}

/** Больше строк в предпросмотре не рендерим: DOM и парсер захлебнутся. */
export const MAX_TABLE_ROWS = 500;

const MARKDOWN_EXTS = new Set(["md", "markdown", "mdown", "mkd", "mdx"]);
const TABLE_EXTS = new Set(["csv", "tsv"]);
const TEXT_EXTS = new Set([
  "txt",
  "log",
  "json",
  "yml",
  "yaml",
  "xml",
  "toml",
  "ini",
  "conf",
  "cfg",
  "env",
  "sql",
  "sh",
  "bash",
  "py",
  "js",
  "mjs",
  "ts",
  "go",
  "css",
  "html",
  "htm",
  "diff",
  "patch",
]);

/** Расширение по имени файла (без пути и query), в нижнем регистре. */
export function fileExtension(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "").split(/[?#]/)[0] ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

/**
 * Тип просмотра по имени и MIME.
 *
 * Имя важнее MIME: сервер вложений часто отдаёт `application/octet-stream`,
 * а `.md` при этом надо рендерить. `null` — файл не текстовый, открывать
 * просмотр нечем (картинки идут в лайтбокс, pdf/zip — на скачивание).
 */
export function viewerKindOf(name: string, mime?: string): ViewerKind | null {
  const ext = fileExtension(name);
  if (MARKDOWN_EXTS.has(ext)) return "markdown";
  if (TABLE_EXTS.has(ext)) return "table";
  if (TEXT_EXTS.has(ext)) return "text";

  const type = (mime ?? "").toLowerCase().split(";")[0]?.trim() ?? "";
  if (!type) return null;
  if (type.includes("markdown")) return "markdown";
  if (type === "text/csv" || type === "text/tab-separated-values") return "table";
  if (type === "application/json" || type === "application/xml" || type === "application/x-yaml") {
    return "text";
  }
  if (type.startsWith("text/")) return "text";
  return null;
}

/** Экранирование для вставки в HTML (`<pre>` и ячейки таблицы). */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Разобрать CSV/TSV с кавычками и переводами строк внутри значений.
 * Разделитель определяется по расширению, а не по содержимому: `;` в русском
 * CSV встречается чаще запятой, поэтому поддерживаем и его.
 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === "") {
      quoted = true;
      continue;
    }
    if (ch === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\r") continue;
    if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((value) => value.trim() !== ""));
}

/** Разделитель для csv: `;`, если в первой строке он встречается чаще запятой. */
export function guessDelimiter(text: string, ext: string): string {
  if (ext === "tsv") return "\t";
  const firstLine = text.split("\n", 1)[0] ?? "";
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return semicolons > commas ? ";" : ",";
}

/** Строки → GFM-таблица (её рендерит общий markdown-парсер). */
export function rowsToMarkdown(rows: string[][]): string {
  if (rows.length === 0) return "";
  const head = rows[0] ?? [];
  const width = Math.max(head.length, 1);
  const line = (cells: string[]): string => {
    const padded = Array.from({ length: width }, (_, i) => (cells[i] ?? "").trim());
    return `| ${padded.map((value) => value.replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ")} |`;
  };
  const body = rows.slice(1, MAX_TABLE_ROWS + 1).map(line);
  const parts = [line(head), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`];
  parts.push(...body);
  if (rows.length - 1 > MAX_TABLE_ROWS) {
    parts.push(`| … | ${Array.from({ length: width - 1 }, () => "…").join(" | ")} |`);
  }
  return parts.join("\n");
}

/** JSON → отформатированный текст; невалидный оставляем как есть. */
export function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/**
 * HTML для тела просмотрщика.
 *
 * `markdown` и `table` идут через общий парсер (санитайзер, подсветка блоков
 * кода, инструменты таблицы), `text` — экранированный `<pre>` без интерпретации.
 */
export function viewerHtml(
  kind: ViewerKind,
  text: string,
  labels: MarkdownLabels = {},
  options: { name?: string } = {},
): string {
  if (kind === "markdown") return renderMarkdown(text, labels);
  if (kind === "table") {
    const ext = fileExtension(options.name ?? "");
    const rows = parseDelimited(text, guessDelimiter(text, ext));
    return renderMarkdown(rowsToMarkdown(rows), labels);
  }
  const ext = fileExtension(options.name ?? "");
  const plain = ext === "json" ? prettyJson(text) : text;
  return `<pre class="doc-viewer__pre">${escapeHtml(plain)}</pre>`;
}

/** Подпись для пустого файла, чтобы модалка не выглядела сломанной. */
export function isEmptyText(text: string): boolean {
  return text.trim() === "";
}
