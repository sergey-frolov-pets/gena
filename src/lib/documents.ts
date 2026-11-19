/**
 * Вложения-документы: текст извлекается прямо в браузере.
 *
 * Сервер Pico принимает в `payload.media` только изображения (`data:image/…`),
 * поэтому pdf/docx/xlsx/txt/md/csv превращаются в текст и уходят в самом
 * сообщении. Тяжёлый парсер (pdfjs) грузится динамически — только когда
 * пользователь действительно прикрепил pdf.
 *
 * docx и xlsx — это zip: распаковываем нативным `DecompressionStream`
 * (`deflate-raw`), без внешних библиотек и без хаков с `<input type=file>`.
 */

export type DocumentKind = "text" | "pdf" | "docx" | "xlsx";

export type DocumentErrorCode = "unsupported" | "too_large" | "empty" | "read";

export class DocumentError extends Error {
  readonly code: DocumentErrorCode;

  constructor(code: DocumentErrorCode) {
    super(code);
    this.name = "DocumentError";
    this.code = code;
  }
}

export interface PreparedDocument {
  kind: DocumentKind;
  name: string;
  /** Размер файла в байтах — для подписи в истории. */
  bytes: number;
  /** Извлечённый текст (уже обрезанный по MAX_TEXT_CHARS). */
  text: string;
  /** Текст обрезан — в сообщение добавлена пометка. */
  truncated: boolean;
}

/** Больше — это уже не вложение, а база данных. */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
/** Сколько символов из документа реально уходит агенту. */
export const MAX_TEXT_CHARS = 40_000;
const MAX_PDF_PAGES = 60;

const TEXT_EXTENSIONS = new Set([
  "txt",
  "text",
  "md",
  "markdown",
  "csv",
  "tsv",
  "json",
  "log",
  "yml",
  "yaml",
  "xml",
  "html",
  "htm",
  "ini",
  "cfg",
  "conf",
  "sql",
]);

const PDF_MIME = "application/pdf";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function extensionOf(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name.trim());
  return match ? match[1].toLowerCase() : "";
}

/** Тип документа по расширению/типу. `null` — формат не поддержан. */
export function documentKindOf(file: { name: string; type?: string }): DocumentKind | null {
  const ext = extensionOf(file.name);
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  if (ext === "pdf" || file.type === PDF_MIME) return "pdf";
  if (ext === "docx" || file.type === DOCX_MIME) return "docx";
  if (ext === "xlsx" || file.type === XLSX_MIME) return "xlsx";
  return null;
}

// --- ZIP (docx/xlsx) -------------------------------------------------------

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
/** Размер EOCD + максимальный комментарий архива. */
const EOCD_SEARCH_BYTES = 66_000;

interface ZipEntry {
  name: string;
  read(): Promise<Uint8Array>;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as unknown as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Минимальное чтение zip-архива: центральный каталог, deflate и store. */
export async function readZip(buffer: ArrayBuffer): Promise<Map<string, ZipEntry>> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  let eocd = -1;
  const first = Math.max(0, buffer.byteLength - EOCD_SEARCH_BYTES);
  for (let i = buffer.byteLength - 22; i >= first; i -= 1) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new DocumentError("read");

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries = new Map<string, ZipEntry>();

  for (let i = 0; i < count && offset + CENTRAL_HEADER_BYTES <= buffer.byteLength; i += 1) {
    if (view.getUint32(offset, true) !== CENTRAL_SIG) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + CENTRAL_HEADER_BYTES, offset + CENTRAL_HEADER_BYTES + nameLength));

    entries.set(name, {
      name,
      read: async () => {
        if (view.getUint32(localOffset, true) !== LOCAL_SIG) throw new DocumentError("read");
        const localName = view.getUint16(localOffset + 26, true);
        const localExtra = view.getUint16(localOffset + 28, true);
        const start = localOffset + LOCAL_HEADER_BYTES + localName + localExtra;
        const raw = bytes.subarray(start, start + compressedSize);
        if (method === 0) return raw.slice();
        if (method === 8) return inflateRaw(raw);
        throw new DocumentError("read");
      },
    });

    offset += CENTRAL_HEADER_BYTES + nameLength + extraLength + commentLength;
  }

  return entries;
}

// --- XML -------------------------------------------------------------------

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeXml(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole: string, code: string) => {
    if (code.startsWith("#")) {
      const hex = code[1] === "x" || code[1] === "X";
      const value = Number.parseInt(hex ? code.slice(2) : code.slice(1), hex ? 16 : 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : whole;
    }
    return XML_ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** Текст узла: убираем теги и раскрываем сущности. */
function nodeText(xml: string): string {
  return decodeXml(xml.replace(/<[^>]+>/g, ""));
}

// --- DOCX ------------------------------------------------------------------

async function docxText(file: File): Promise<string> {
  const zip = await readZip(await file.arrayBuffer());
  const main = zip.get("word/document.xml");
  if (!main) throw new DocumentError("read");
  const xml = new TextDecoder().decode(await main.read());
  const withBreaks = xml
    .replace(/<w:tab\s*\/>/g, "\t")
    .replace(/<w:br\s*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n");
  return nodeText(withBreaks)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// --- XLSX ------------------------------------------------------------------

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref.toUpperCase());
  if (!letters) return 0;
  let index = 0;
  for (const char of letters[0]) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

function parseSharedStrings(xml: string): string[] {
  return (xml.match(/<si>[\s\S]*?<\/si>/g) ?? []).map((block) =>
    (block.match(/<t[^>]*>[\s\S]*?<\/t>/g) ?? [])
      .map((part) => nodeText(part))
      .join(""),
  );
}

function parseSheetRows(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowXml of xml.match(/<row[\s\S]*?<\/row>|<row[^>]*\/>/g) ?? []) {
    const cells: string[] = [];
    for (const cellXml of rowXml.match(/<c[\s\S]*?<\/c>|<c[^>]*\/>/g) ?? []) {
      const ref = /r="([^"]+)"/.exec(cellXml)?.[1] ?? "";
      const type = /t="([^"]+)"/.exec(cellXml)?.[1] ?? "";
      let value = "";
      if (type === "inlineStr") {
        value = (cellXml.match(/<t[^>]*>[\s\S]*?<\/t>/g) ?? []).map((part) => nodeText(part)).join("");
      } else {
        const raw = /<v[^>]*>([\s\S]*?)<\/v>/.exec(cellXml)?.[1] ?? "";
        if (type === "s") {
          const index = Number.parseInt(raw, 10);
          value = Number.isFinite(index) ? (shared[index] ?? "") : "";
        } else {
          value = decodeXml(raw);
        }
      }
      cells[columnIndex(ref)] = value;
    }
    rows.push(Array.from(cells, (cell) => cell ?? ""));
  }
  return rows;
}

function csvCell(value: string): string {
  return /[",\n\r;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

async function sheetNames(zip: Map<string, ZipEntry>): Promise<string[]> {
  const workbook = zip.get("xl/workbook.xml");
  if (!workbook) return [];
  const xml = new TextDecoder().decode(await workbook.read());
  return (xml.match(/<sheet[^>]*name="[^"]*"/g) ?? []).map(
    (tag) => decodeXml(/name="([^"]*)"/.exec(tag)?.[1] ?? ""),
  );
}

async function xlsxText(file: File): Promise<string> {
  const zip = await readZip(await file.arrayBuffer());
  const sharedEntry = zip.get("xl/sharedStrings.xml");
  const shared = sharedEntry
    ? parseSharedStrings(new TextDecoder().decode(await sharedEntry.read()))
    : [];
  const sheets = [...zip.values()]
    .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const names = await sheetNames(zip);

  const parts: string[] = [];
  for (const [index, entry] of sheets.entries()) {
    const rows = parseSheetRows(new TextDecoder().decode(await entry.read()), shared);
    if (rows.length === 0) continue;
    const title = names[index] ?? entry.name;
    parts.push(`# ${title}\n${rows.map((row) => row.map(csvCell).join(",")).join("\n")}`);
  }
  return parts.join("\n\n");
}

// --- PDF -------------------------------------------------------------------

async function pdfText(file: File): Promise<string> {
  const [{ getDocument, GlobalWorkerOptions }, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  GlobalWorkerOptions.workerSrc = worker.default;

  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const pages: string[] = [];
  try {
    const last = Math.min(doc.numPages, MAX_PDF_PAGES);
    for (let pageNumber = 1; pageNumber <= last; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const line = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (line) pages.push(line);
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return pages.join("\n\n");
}

// --- Публичное API ---------------------------------------------------------

export async function prepareDocument(file: File): Promise<PreparedDocument> {
  const kind = documentKindOf(file);
  if (!kind) throw new DocumentError("unsupported");
  if (file.size > MAX_DOCUMENT_BYTES) throw new DocumentError("too_large");

  let text = "";
  try {
    if (kind === "text") text = await file.text();
    else if (kind === "pdf") text = await pdfText(file);
    else if (kind === "docx") text = await docxText(file);
    else text = await xlsxText(file);
  } catch (error) {
    if (error instanceof DocumentError) throw error;
    throw new DocumentError("read");
  }

  const normalised = text.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim();
  if (!normalised) throw new DocumentError("empty");

  const truncated = normalised.length > MAX_TEXT_CHARS;
  return {
    kind,
    name: file.name,
    bytes: file.size,
    text: truncated ? normalised.slice(0, MAX_TEXT_CHARS) : normalised,
    truncated,
  };
}

/** Размер файла для подписи: 820 Б, 12.4 КБ, 3.1 МБ. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

/** Сообщение агенту: текст пользователя + содержимое документов. */
export function documentsToMessage(text: string, docs: PreparedDocument[]): string {
  const blocks = docs.map((doc) => {
    const tail = doc.truncated ? `\n…[обрезано: первые ${MAX_TEXT_CHARS} символов]` : "";
    return `=== ${doc.name} · ${formatBytes(doc.bytes)} ===\n${doc.text}${tail}`;
  });
  return [text.trim(), ...blocks].filter(Boolean).join("\n\n");
}
