#!/usr/bin/env node
/**
 * Проверка файла словаря перед коммитом.
 *
 * Повторяет правила `src/lib/tokens/morph/format.ts` без TypeScript: формат,
 * версия, порядок падежей, число форм в записи и заметный запас лемм. Нужен,
 * чтобы битый файл не уехал в сборку — в браузере он просто не загрузится.
 *
 *   node scripts/check-morph.mjs [путь]
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const CASES = ["nomn", "gent", "datv", "accs", "ablt", "loct"];
const NOUN_SLOTS = 12;
const ADJ_SLOTS = 24;

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(process.argv[2] ?? resolve(here, "..", "public", "morph", "ru-morph-v1.json"));

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

let dict;
try {
  dict = JSON.parse(readFileSync(target, "utf8"));
} catch (error) {
  fail(`файл не читается как JSON: ${error.message}`);
}

if (dict.format !== "gena.morph") fail(`формат ${JSON.stringify(dict.format)}`);
if (dict.version !== 1) fail(`версия ${String(dict.version)}`);
if (!Array.isArray(dict.cases) || dict.cases.join(",") !== CASES.join(",")) {
  fail(`порядок падежей: ${String(dict.cases)}`);
}
if (!dict.lemmas || typeof dict.lemmas !== "object") fail("нет блока lemmas");

const keys = Object.keys(dict.lemmas);
if (keys.length < 5000) fail(`слишком мало лемм: ${keys.length}`);

let nouns = 0;
let adjectives = 0;
for (const key of keys) {
  const entry = dict.lemmas[key];
  if (!entry || typeof entry !== "object") fail(`запись ${key} не объект`);
  if (entry.p === "N") {
    nouns += 1;
    if (!Array.isArray(entry.f) || entry.f.length !== NOUN_SLOTS) {
      fail(`у ${key} не ${NOUN_SLOTS} форм`);
    }
    continue;
  }
  if (entry.p === "A") {
    adjectives += 1;
    if (!Array.isArray(entry.f) || entry.f.length !== ADJ_SLOTS) {
      fail(`у ${key} не ${ADJ_SLOTS} форм`);
    }
    continue;
  }
  fail(`у ${key} неизвестная часть речи ${JSON.stringify(entry.p)}`);
}

for (const sample of ["вклад", "счёт", "карта", "рубль"]) {
  if (!dict.lemmas[sample]) fail(`нет контрольной леммы ${sample}`);
}

const bytes = readFileSync(target).byteLength;
console.log(
  `OK: ${keys.length} лемм (сущ ${nouns}, прил ${adjectives}), ` +
    `${(bytes / 1024 / 1024).toFixed(2)} МиБ, ${dict.createdAt ?? "без даты"}`,
);
