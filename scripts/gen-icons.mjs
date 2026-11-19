// Генерация PNG-наборов иконки из public/icon.svg (sharp).
// Запуск: node scripts/gen-icons.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(join(root, "public/icon.svg"));

const targets = [
  { file: "favicon-32.png", size: 32 },
  { file: "favicon-48.png", size: 48 },
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  { file: "apple-touch-icon.png", size: 180 },
  { file: "icon-maskable-512.png", size: 512, pad: 0.12 },
];

for (const t of targets) {
  let img = sharp(svg).resize(t.size, t.size);
  if (t.pad) {
    // maskable: отступ по safe zone, фон залит — иконка не обрежется маской
    const inner = Math.round(t.size * (1 - t.pad * 2));
    const innerBuf = await sharp(svg).resize(inner, inner).png().toBuffer();
    img = sharp({
      create: { width: t.size, height: t.size, channels: 4, background: "#f1f5f2" },
    }).composite([{ input: innerBuf, gravity: "center" }]);
  }
  await img.png({ compressionLevel: 9 }).toFile(join(root, "public", t.file));
  console.log("✓", t.file);
}

// favicon.ico — контейнер ICO с PNG 32 и 48
const png32 = await sharp(svg).resize(32, 32).png().toBuffer();
const png48 = await sharp(svg).resize(48, 48).png().toBuffer();
const ico = buildIco([png32, png48]);
writeFileSync(join(root, "public/favicon.ico"), ico);
console.log("✓ favicon.ico");

function buildIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  const entries = [];
  let offset = 6 + 16 * count;
  for (const png of images) {
    const dim = png.readUInt32BE(16); // width из IHDR
    const e = Buffer.alloc(16);
    e.writeUInt8(dim >= 256 ? 0 : dim, 0);
    e.writeUInt8(dim >= 256 ? 0 : dim, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images]);
}
