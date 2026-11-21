/**
 * Таблица из чата → текст для буфера, CSV и XLSX.
 * XLSX пишется без сжатия: это zip из нескольких XML, библиотека не нужна.
 */

export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function toTsv(rows: string[][]): string {
  return rows.map((row) => row.map((cell) => cell.replace(/\t/g, " ").replace(/\r?\n/g, " ")).join("\t")).join("\n");
}

function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function xlsxBlob(rows: string[][]): Blob {
  const bytes = toXlsx(rows);
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function toXlsx(rows: string[][]): Uint8Array {
  const sheet = sheetXml(rows);
  return zipStore([
    { name: "[Content_Types].xml", data: textBytes(CONTENT_TYPES) },
    { name: "_rels/.rels", data: textBytes(ROOT_RELS) },
    { name: "xl/workbook.xml", data: textBytes(WORKBOOK) },
    { name: "xl/_rels/workbook.xml.rels", data: textBytes(WORKBOOK_RELS) },
    { name: "xl/worksheets/sheet1.xml", data: textBytes(sheet) },
  ]);
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Table" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

function sheetXml(rows: string[][]): string {
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          const ref = `${columnName(c)}${r + 1}`;
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

function columnName(index: number): string {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function xmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function textBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** Zip без сжатия (method 0): Excel открывает такой xlsx. */
function zipStore(entries: ZipEntry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = textBytes(entry.name);
    const crc = crc32(entry.data);
    const local = new Uint8Array(30 + name.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(8, 0, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, entry.data.length, true);
    view.setUint32(22, entry.data.length, true);
    view.setUint16(26, name.length, true);
    local.set(name, 30);
    locals.push(local, entry.data);

    const central = new Uint8Array(46 + name.length);
    const cd = new DataView(central.buffer);
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(10, 0, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, entry.data.length, true);
    cd.setUint32(24, entry.data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length + entry.data.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const eocd = new DataView(end.buffer);
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, offset, true);
  const total = offset + centralSize + end.length;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
