#!/usr/bin/env node
// Поднимает версию Gena в одном месте и разносит её по файлам, где она реально живёт:
//   package.json           -> version
//   src/components/AppFooter.vue -> const VERSION = "x.y.z"
//   public/sw.js           -> const CACHE = "gena-cache-vx.y.z"
// Запуск: node scripts/bump-version.mjs [patch|minor|major|x.y.z] [--dry-run]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const target = args.find((a) => !a.startsWith("--")) ?? "patch";

const pkgPath = resolve(root, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

function nextVersion(current, mode) {
  if (/^\d+\.\d+\.\d+$/.test(mode)) return mode;
  const [major, minor, patch] = current.split(".").map((n) => Number.parseInt(n, 10) || 0);
  if (mode === "major") return `${major + 1}.0.0`;
  if (mode === "minor") return `${major}.${minor + 1}.0`;
  if (mode === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Неизвестный режим версии: ${mode} (ожидается patch|minor|major|x.y.z)`);
}

const from = pkg.version ?? "0.0.0";
const to = nextVersion(from, target);

const rewrites = [
  {
    label: "package.json",
    file: pkgPath,
    apply: (src) => src.replace(/"version"\s*:\s*"[^"]*"/, `"version": "${to}"`),
  },
  {
    label: "src/components/AppFooter.vue",
    file: resolve(root, "src/components/AppFooter.vue"),
    apply: (src) => src.replace(/const VERSION = "[^"]*";/, `const VERSION = "${to}";`),
  },
  {
    label: "public/sw.js",
    file: resolve(root, "public/sw.js"),
    apply: (src) => src.replace(/const CACHE = "gena-cache-v[^"]*";/, `const CACHE = "gena-cache-v${to}";`),
  },
];

let changed = 0;
for (const { label, file, apply } of rewrites) {
  const before = readFileSync(file, "utf8");
  const after = apply(before);
  if (after === before && label !== "package.json") {
    console.warn(`! ${label}: шаблон версии не найден, файл не изменён`);
    continue;
  }
  if (after !== before) {
    changed += 1;
    if (!dryRun) writeFileSync(file, after);
  }
}

if (dryRun) {
  console.log(`[dry-run] версия: ${from} -> ${to}, файлов к правке: ${changed}`);
} else {
  console.log(`версия: ${from} -> ${to} (обновлено файлов: ${changed})`);
  console.log(to);
}