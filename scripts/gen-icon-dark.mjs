// Тёмный вариант иконки: тёмный фон + светло-зелёный крокодил.
// Источник — public/icon.svg, результат — public/icon-dark.svg.
// Запуск: node scripts/gen-icon-dark.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "public/icon.svg"), "utf8");

const BG_STOPS = [
  ['stop-color="#ffffff"', 'stop-color="#1b2420"'],
  ['stop-color="#f1f5f2"', 'stop-color="#141a17"'],
  ['stop-color="#dfe9e2"', 'stop-color="#0d1210"'],
];

let svg = source;
for (const [from, to] of BG_STOPS) {
  svg = svg.split(from).join(to);
}
// Логотип: тёмно-зелёный (#146B2C) → светло-зелёный.
svg = svg.split('fill="#146B2C"').join('fill="#7BD88F"');

if (!svg.includes("#7BD88F") || !svg.includes("#0d1210")) {
  throw new Error("icon-dark: замены не применились — проверь исходный icon.svg");
}

writeFileSync(join(root, "public/icon-dark.svg"), svg);
console.log("✓ icon-dark.svg");
