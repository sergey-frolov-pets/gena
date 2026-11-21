// Тёмный вариант иконки: тёмный градиент + светло-зелёный рисунок.
// Источник — public/icon.svg, результат — public/icon-dark.svg.
// Запуск: node scripts/gen-icon-dark.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "public/icon.svg"), "utf8");

// Градиент по структуре как у светлого (3 стопа, диагональ), но с заметным
// перепадом: у светлого ~#fff → #dfe9e2, здесь ~#24312a → #0a0f0c.
const BG_STOPS = [
  ['stop-color="#ffffff"', 'stop-color="#24312a"'],
  ['stop-color="#f1f5f2"', 'stop-color="#151c19"'],
  ['stop-color="#dfe9e2"', 'stop-color="#0a0f0c"'],
];

let svg = source;
for (const [from, to] of BG_STOPS) {
  svg = svg.split(from).join(to);
}
// Логотип: тёмно-зелёный (#146B2C) → светло-зелёный.
svg = svg.split('fill="#146B2C"').join('fill="#7BD88F"');

if (!svg.includes("#7BD88F") || !svg.includes("#0a0f0c")) {
  throw new Error("icon-dark: замены не применились — проверь исходный icon.svg");
}

writeFileSync(join(root, "public/icon-dark.svg"), svg);
console.log("✓ icon-dark.svg");
